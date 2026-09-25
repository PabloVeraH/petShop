import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { CANALES_EXTERNOS } from "@/lib/canales/domain/types";
import { obtenerAdaptador } from "@/lib/canales/adapters/registry";
import { encolarTrabajoTienda, procesarOutbox } from "@/lib/canales/application/outbox";

// "Publicar catálogo" (paso 4.5). Solo storeAdmin/systemAdmin (D8), validado
// aquí. ENCOLA un trabajo 'catalog' (el worker arma el catálogo con los
// productos habilitados y el precio del canal, lo envía y luego encola la
// disponibilidad completa) y responde 202. Reemplaza la versión anterior, que
// llamaba al adaptador heredado sin credenciales (C4) y publicaba TODOS los
// productos activos con precio 0 cuando no tenían configuración.
const bodySchema = z.object({ canal_id: z.enum(CANALES_EXTERNOS) });

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId, userId } = ctx;

  const { sessionClaims } = await auth();
  try {
    requireStoreAdmin(getAdminStatus(sessionClaims), storeId);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Canal inválido" }, { status: 400 });
  const { canal_id } = parsed.data;

  if (!obtenerAdaptador(canal_id)) {
    return NextResponse.json({ error: "Integración pendiente: este canal aún no se puede publicar" }, { status: 409 });
  }

  const supabase = createServiceClient();
  const { data: config } = await supabase
    .from("canal_config")
    .select("id, activo")
    .eq("store_id", storeId)
    .eq("canal_id", canal_id)
    .maybeSingle();
  if (!config) return NextResponse.json({ error: "Canal no configurado" }, { status: 404 });
  if (!config.activo) return NextResponse.json({ error: "Canal inactivo" }, { status: 409 });

  const { count } = await supabase
    .from("canal_producto_config")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId)
    .eq("canal_id", canal_id)
    .eq("activo", true);
  if (!count) {
    return NextResponse.json({ error: "No hay productos habilitados para este canal" }, { status: 422 });
  }

  const nuevo = await encolarTrabajoTienda(supabase, {
    storeId,
    canalId: canal_id,
    tipo: "catalog",
    payload: {},
    dedupeKey: `catalog:${storeId}:${canal_id}`,
  });

  after(async () => {
    try {
      await procesarOutbox(supabase, 5);
    } catch (e) {
      console.error("[canales/catalog] error procesando la outbox:", e);
    }
  });

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId,
    userId,
    action: "UPDATE",
    entityType: "canal_catalog",
    entityId: config.id,
    changeDescription: `Publicación de catálogo encolada en ${canal_id} (${count} productos habilitados)`,
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

  return NextResponse.json({ status: nuevo ? "encolado" : "ya_en_curso", habilitados: count }, { status: 202 });
}, { endpoint: "POST /api/canales/catalog" });
