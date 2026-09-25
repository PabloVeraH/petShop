import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";
import { cronAutorizado } from "@/lib/cron-auth";
import { obtenerAdaptador } from "@/lib/canales/adapters/registry";
import { esCanalExterno } from "@/lib/canales/domain/types";
import { claveDisponibilidadCompleta, encolarTrabajoTienda } from "@/lib/canales/application/outbox";

// Reconciliación diaria de disponibilidad (paso 4.6, §4.4). Red de seguridad
// del trigger de la migración 082: republica el estado COMPLETO de cada
// tienda/canal con catálogo publicado. Cubre lo que el trigger no ve:
// lotes que vencen (D23) o licencias que vencen (D15) con el paso del
// tiempo, un canal reactivado, un cambio perdido mientras otro trabajo se
// procesaba, o una llamada que terminó 'dead'.
//
// Solo ENCOLA (dedupe avail-full:{store}:{canal} → idempotente ante
// ejecuciones solapadas); el envío lo hace el worker de la outbox
// (/api/cron/canales-outbox). Programación: pg_cron + pg_net una vez al día
// (§7.1, D12), pendiente de despliegue — no está en vercel.json.

async function reconciliar(req: NextRequest) {
  if (!cronAutorizado(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();

  const { data: publicados, error } = await supabase
    .from("canal_producto_config")
    .select("store_id, canal_id")
    .not("publicado_at", "is", null);
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const pares = new Map<string, { storeId: string; canalId: string }>();
  for (const f of publicados ?? []) pares.set(`${f.store_id}:${f.canal_id}`, { storeId: f.store_id, canalId: f.canal_id });

  const { data: activos } = await supabase
    .from("canal_config")
    .select("store_id, canal_id")
    .eq("activo", true);
  const activosSet = new Set((activos ?? []).map((c) => `${c.store_id}:${c.canal_id}`));

  let encolados = 0;
  let omitidos = 0;
  for (const [clave, { storeId, canalId }] of pares) {
    // Canal no desplegado o tienda con el canal inactivo: no hay con quién
    // hablar (loadChannelContext fallaría y el trabajo terminaría 'dead').
    if (!esCanalExterno(canalId) || !obtenerAdaptador(canalId) || !activosSet.has(clave)) {
      omitidos++;
      continue;
    }
    try {
      const nuevo = await encolarTrabajoTienda(supabase, {
        storeId,
        canalId,
        tipo: "availability",
        payload: { completo: true },
        dedupeKey: claveDisponibilidadCompleta(storeId, canalId),
      });
      if (nuevo) encolados++;
    } catch (e) {
      console.error("[cron/canales-reconciliar] no se pudo encolar:", e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true, encolados, omitidos });
}

// pg_net envía POST; GET se acepta para una invocación manual.
export const POST = withErrorLogging(reconciliar, { endpoint: "POST /api/cron/canales-reconciliar" });
export const GET = withErrorLogging(reconciliar, { endpoint: "GET /api/cron/canales-reconciliar" });
