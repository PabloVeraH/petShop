import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { UUIDSchema } from "@/lib/validation";
import { procesarOrden } from "@/lib/canales/application/procesar-orden";
import { procesarOutbox } from "@/lib/canales/application/outbox";

// Reintentar una orden 'failed' (paso 3.7: lo único manual que queda; la
// aceptación es automática — D5). Solo storeAdmin/systemAdmin (D8), validado
// aquí. failed → pending (intentos a 0) y se reprocesa tras responder.
export const POST = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId, userId } = ctx;

  const { sessionClaims } = await auth();
  try {
    requireStoreAdmin(getAdminStatus(sessionClaims), storeId);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!UUIDSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("canal_ordenes")
    .update({ estado: "pending", intentos: 0, ultimo_error: null })
    .eq("id", id)
    .eq("store_id", storeId)
    .eq("estado", "failed")
    .select("id, external_order_id, canal_id");
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const orden = data?.[0];
  if (!orden) {
    const { data: existe } = await supabase
      .from("canal_ordenes")
      .select("estado")
      .eq("id", id)
      .eq("store_id", storeId)
      .maybeSingle();
    if (!existe) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    return NextResponse.json({ error: "Solo una orden fallida puede reintentarse" }, { status: 409 });
  }

  after(async () => {
    try {
      await procesarOrden(supabase, storeId, orden.id);
      await procesarOutbox(supabase, 5);
    } catch (e) {
      console.error("[canales/retry] error reprocesando la orden:", e);
    }
  });

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId,
    userId,
    action: "UPDATE",
    entityType: "canal_ordenes",
    entityId: orden.id,
    changeDescription: `Reintento de la orden fallida ${orden.external_order_id} (${orden.canal_id})`,
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

  return NextResponse.json({ id: orden.id, estado: "pending" });
}, { endpoint: "POST /api/canales/orders/id/retry" });
