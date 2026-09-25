import type { SupabaseClient } from "@supabase/supabase-js";
import { UUIDSchema } from "@/lib/validation";
import { esCanalExterno, type CanalExternoId, type EventoCanal } from "../domain/types";
import { obtenerAdaptador } from "../adapters/registry";
import { PayloadInvalidoError, type ChannelContext } from "../adapters/port";
import {
  CanalNoConfiguradoError,
  CredencialesInvalidasError,
  loadChannelContext,
} from "../infrastructure/context";

export interface RespuestaWebhook {
  status: number;
  body: unknown;
}

export interface EntradaWebhook {
  supabase: SupabaseClient;
  canal: string;
  storeId: string | null;
  evento: string | null;
  headers: Headers;
  rawBody: string;
}

// Caso de uso del webhook genérico (§4.2 pasos 1–4, pasos 2.5 del plan):
// verifica, traduce y persiste. NO acepta la orden ni descuenta stock: eso es
// procesarOrden (Fase 3). Nunca loguea el cuerpo (trae datos de clientes).
export async function recibirEventoWebhook(e: EntradaWebhook): Promise<RespuestaWebhook> {
  // 1. Canal implementado y habilitado en el despliegue (C2: antes solo Rappi
  //    por un if; PedidosYa/UberEats → "Integración pendiente").
  const adapter = obtenerAdaptador(e.canal);
  if (!adapter || !esCanalExterno(e.canal)) {
    return { status: 404, body: { error: "Canal no disponible" } };
  }
  const canalId: CanalExternoId = e.canal;

  // 2. store_id de la URL registrada en la plataforma.
  if (!e.storeId || !UUIDSchema.safeParse(e.storeId).success) {
    return { status: 400, body: { error: "store_id inválido" } };
  }

  // 3. Contexto de la tienda (habilitación global + por tienda, credenciales).
  let ctx: ChannelContext;
  try {
    ctx = await loadChannelContext(e.supabase, e.storeId, canalId, adapter);
  } catch (err) {
    if (err instanceof CanalNoConfiguradoError) {
      return { status: 404, body: { error: "Canal no configurado o inactivo" } };
    }
    if (err instanceof CredencialesInvalidasError) {
      console.error(`[canales/webhook] ${canalId} store=${e.storeId}: ${err.message}`);
      return { status: 503, body: { error: "Canal mal configurado" } };
    }
    throw err;
  }

  const req = { headers: e.headers, rawBody: e.rawBody, evento: e.evento };

  // 4. Autenticidad (firma + anti-replay del adaptador).
  if (!adapter.verifyWebhook(req, ctx)) {
    return { status: 401, body: { error: "Firma inválida" } };
  }

  // 5. Traducción a EventoCanal (Zod dentro del adaptador).
  let evento: EventoCanal;
  try {
    evento = adapter.parseEvent(req);
  } catch (err) {
    if (err instanceof PayloadInvalidoError) {
      console.warn(`[canales/webhook] ${canalId} store=${e.storeId}: payload inválido (${err.message})`);
      return { status: 400, body: { error: "Payload inválido" } };
    }
    throw err;
  }

  // 6. El evento debe ser de la tienda configurada: el secreto es por cliente
  //    de la plataforma, no por tienda.
  const idsEvento = "orden" in evento ? evento.orden.externalStoreIds
    : "externalStoreIds" in evento ? evento.externalStoreIds : [];
  if (ctx.externalStoreId && idsEvento.length > 0 && !idsEvento.includes(ctx.externalStoreId)) {
    console.warn(`[canales/webhook] ${canalId} store=${e.storeId}: evento de otra tienda de la plataforma`);
    return { status: 403, body: { error: "El evento no corresponde a esta tienda" } };
  }

  switch (evento.tipo) {
    case "ping":
      return adapter.pingResponse?.() ?? { status: 200, body: { status: "ok" } };

    case "orden_creada": {
      const { orden } = evento;
      // INSERT … ON CONFLICT (store_id, canal_id, external_order_id) DO NOTHING
      // (C16): una reentrega o dos entregas concurrentes dejan una sola fila.
      const { data, error } = await e.supabase
        .from("canal_ordenes")
        .upsert(
          {
            store_id: ctx.storeId,
            canal_id: canalId,
            external_order_id: orden.externalOrderId,
            estado: "pending",
            payload: JSON.parse(e.rawBody),
            items: orden.items.map((i) => ({
              sku: i.sku,
              nombre: i.nombre ?? null,
              cantidad: i.cantidad,
              precio_unitario_bruto: i.precioUnitarioBruto,
            })),
            total_externo: orden.totalBruto,
            aceptar_antes_de: new Date(Date.now() + adapter.capabilities.acceptanceWindowMin * 60_000).toISOString(),
          },
          { onConflict: "store_id,canal_id,external_order_id", ignoreDuplicates: true }
        )
        .select("id");
      if (error) {
        console.error(`[canales/webhook] ${canalId} store=${e.storeId}: error guardando orden (${error.code ?? "?"})`);
        return { status: 500, body: { error: "Error guardando la orden" } };
      }
      const fila = data?.[0];
      if (!fila) return { status: 200, body: { status: "ok", duplicada: true } };
      return { status: 201, body: { status: "ok", ordenId: fila.id } };
    }

    case "orden_cancelada": {
      // Fase 2: solo una orden aún 'pending' pasa a 'cancelled' (transición
      // válida según domain/estados). Cancelar una orden ya aceptada exige
      // anular la venta (anular_venta_tx) — Fase 3.5 — así que aquí no se toca.
      await e.supabase
        .from("canal_ordenes")
        .update({ estado: "cancelled", updated_at: new Date().toISOString() })
        .eq("store_id", ctx.storeId)
        .eq("canal_id", canalId)
        .eq("external_order_id", evento.externalOrderId)
        .eq("estado", "pending");
      return { status: 200, body: { status: "ok" } };
    }

    case "menu_rechazado":
      console.warn(`[canales/webhook] ${canalId} store=${e.storeId}: menú rechazado por la plataforma`);
      return { status: 200, body: { status: "ok" } };

    case "estado_cambiado":
    case "menu_aprobado":
    case "ignorado":
      return { status: 200, body: { status: "ok" } };
  }
}
