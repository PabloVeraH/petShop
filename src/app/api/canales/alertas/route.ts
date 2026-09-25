import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { UUIDSchema } from "@/lib/validation";
import { autorizarCanales } from "@/lib/canales/infrastructure/autorizacion";
import { procesarOutbox } from "@/lib/canales/application/outbox";
import { armarAlertas, type FilaConfigMenu, type FilaOrdenFallida, type FilaOutboxAlerta } from "@/lib/canales/application/alertas";

// Alertas de canales (Fase 5, paso 5.3; §5.3 del plan: "dead → alerta al
// admin … o registro visible en UI"). Solo storeAdmin/systemAdmin de la
// tienda. Se derivan del estado actual (sin tabla propia): llamadas muertas o
// reintentando, órdenes fallidas, credenciales/token rechazados y menú
// rechazado por la plataforma.

const LIMITE = 50;

export const GET = withErrorLogging(async () => {
  const ctx = await autorizarCanales({ soloAdmin: true });
  if (!ctx.ok) return ctx.response;
  const supabase = createServiceClient();

  const [outbox, ordenes, configs] = await Promise.all([
    supabase
      .from("canal_outbox")
      .select("id, canal_id, tipo, estado, intentos, last_error, updated_at")
      .eq("store_id", ctx.storeId)
      .or("estado.eq.dead,and(estado.eq.pending,intentos.gte.2)")
      .order("updated_at", { ascending: false })
      .limit(LIMITE),
    supabase
      .from("canal_ordenes")
      .select("id, canal_id, external_order_id, ultimo_error, updated_at")
      .eq("store_id", ctx.storeId)
      .eq("estado", "failed")
      .order("updated_at", { ascending: false })
      .limit(LIMITE),
    supabase
      .from("canal_config")
      .select("canal_id, menu_estado, menu_detalle, menu_estado_at")
      .eq("store_id", ctx.storeId)
      .eq("menu_estado", "rechazado"),
  ]);
  if (outbox.error || ordenes.error || configs.error) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const alertas = armarAlertas(
    (outbox.data ?? []) as FilaOutboxAlerta[],
    (ordenes.data ?? []) as FilaOrdenFallida[],
    (configs.data ?? []) as FilaConfigMenu[]
  );
  return NextResponse.json({ alertas, total: alertas.length });
}, { endpoint: "GET /api/canales/alertas" });

// Reintentar UNA llamada 'dead' (la reconciliación diaria cubre la
// disponibilidad, pero no confirmar/rechazar/lista/catálogo).
const reintentoSchema = z.object({ id: UUIDSchema }).strict();

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await autorizarCanales({ soloAdmin: true });
  if (!ctx.ok) return ctx.response;

  const parsed = reintentoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Trabajo inválido" }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("canal_outbox")
    .update({ estado: "pending", intentos: 0, last_error: null, next_attempt_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("store_id", ctx.storeId)
    .eq("estado", "dead")
    .select("id, canal_id, tipo");
  if (error) {
    // Índice único de trabajos vivos (079): ya hay uno equivalente en curso.
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ya hay un trabajo equivalente en curso" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
  const trabajo = data?.[0];
  if (!trabajo) return NextResponse.json({ error: "Trabajo no encontrado o no está detenido" }, { status: 404 });

  after(async () => {
    try {
      await procesarOutbox(supabase, 5);
    } catch (e) {
      console.error("[canales/alertas] error procesando la outbox:", e);
    }
  });

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "canal_outbox",
    entityId: trabajo.id,
    changeDescription: `Reintento manual de la llamada ${trabajo.tipo} a ${trabajo.canal_id}`,
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

  return NextResponse.json({ id: trabajo.id, estado: "pending" });
}, { endpoint: "POST /api/canales/alertas" });
