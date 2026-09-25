import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";
import { procesarOrden } from "@/lib/canales/application/procesar-orden";
import { procesarOutbox } from "@/lib/canales/application/outbox";
import { cronAutorizado } from "@/lib/cron-auth";

// Barrido de canales externos (paso 3.4). NO está en vercel.json: el plan
// Hobby rechaza crons de más de 1 vez/día (D12). Lo invoca pg_cron + pg_net
// cada minuto (§7.1; la migración de programación se crea SOLO después de
// desplegar este endpoint). Idempotente y tolerante a solapamiento: el
// reclamo de órdenes (pending → processing) y de la outbox
// (FOR UPDATE SKIP LOCKED) impiden procesar dos veces lo mismo.
//
// 1. Órdenes que quedaron 'processing' más de 5 min (el proceso murió) →
//    vuelven a 'pending'.
// 2. Órdenes 'pending' con más de 1 min (after() del webhook no llegó a
//    correr) → procesarOrden.
// 3. Outbox: un lote de llamadas salientes.

const MIN_ATASCADA_PROCESSING = 5;
const MIN_PENDIENTE_OLVIDADA = 1;
const LOTE_ORDENES = 20;
const LOTE_OUTBOX = 20;

async function barrer(req: NextRequest) {
  if (!cronAutorizado(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const ahora = Date.now();

  const { data: recuperadas } = await supabase
    .from("canal_ordenes")
    .update({ estado: "pending", ultimo_error: "Procesamiento interrumpido; se reintenta" })
    .eq("estado", "processing")
    .lt("updated_at", new Date(ahora - MIN_ATASCADA_PROCESSING * 60_000).toISOString())
    .select("id");

  const { data: pendientes } = await supabase
    .from("canal_ordenes")
    .select("id, store_id")
    .eq("estado", "pending")
    .lt("created_at", new Date(ahora - MIN_PENDIENTE_OLVIDADA * 60_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(LOTE_ORDENES);

  const resumenOrdenes: Record<string, number> = {};
  for (const o of pendientes ?? []) {
    try {
      const r = await procesarOrden(supabase, o.store_id, o.id);
      resumenOrdenes[r.resultado] = (resumenOrdenes[r.resultado] ?? 0) + 1;
    } catch (e) {
      console.error(`[cron/canales-outbox] error procesando orden ${o.id}:`, e);
      resumenOrdenes.error = (resumenOrdenes.error ?? 0) + 1;
    }
  }

  const outbox = await procesarOutbox(supabase, LOTE_OUTBOX);

  return NextResponse.json({
    ok: true,
    recuperadas: recuperadas?.length ?? 0,
    ordenes: resumenOrdenes,
    outbox,
  });
}

// pg_net envía POST; GET se acepta para una invocación manual o Vercel.
export const POST = withErrorLogging(barrer, { endpoint: "POST /api/cron/canales-outbox" });
export const GET = withErrorLogging(barrer, { endpoint: "GET /api/cron/canales-outbox" });
