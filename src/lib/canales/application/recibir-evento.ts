import type { SupabaseClient } from "@supabase/supabase-js";
import { UUIDSchema } from "@/lib/validation";
import { esCanalExterno, type CanalExternoId, type EventoCanal } from "../domain/types";
import { obtenerAdaptador } from "../adapters/registry";
import { PayloadInvalidoError, type ChannelContext } from "../adapters/port";
import { cancelarOrdenCanal } from "./cancelar-orden";
import { registrarEstadoMenu } from "./menu";
import {
  CanalNoConfiguradoError,
  CredencialesInvalidasError,
  loadChannelContext,
} from "../infrastructure/context";

export interface RespuestaWebhook {
  status: number;
  body: unknown;
  // Orden recién creada que el handler debe procesar DESPUÉS de responder
  // (after() — §4.2 paso 5). El cron la reintenta si after() no llega a correr.
  procesarOrden?: { storeId: string; ordenId: string };
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

  // 6.2: último evento AUTENTICADO — prueba de que el webhook quedó
  // registrado con la URL y el secreto correctos (Rappi envía PING cada 3
  // min). No bloquea: un fallo aquí no debe rechazar el evento.
  const { error: errEvento } = await e.supabase
    .from("canal_config")
    .update({ ultimo_evento_at: new Date().toISOString(), ultimo_evento_tipo: (e.evento ?? "desconocido").slice(0, 60) })
    .eq("store_id", ctx.storeId)
    .eq("canal_id", canalId);
  if (errEvento) console.error(`[canales/webhook] ${canalId}: no se pudo registrar el último evento (${errEvento.code ?? "error"})`);

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
      return {
        status: 201,
        body: { status: "ok", ordenId: fila.id },
        procesarOrden: { storeId: ctx.storeId, ordenId: fila.id },
      };
    }

    case "orden_cancelada": {
      // 3.5: pending → cancelled; aceptada/lista → anular la venta y cancelar.
      const r = await cancelarOrdenCanal(e.supabase, ctx.storeId, canalId, evento.externalOrderId, evento.motivo);
      if (r.resultado === "en_proceso") {
        // La orden se está procesando: la plataforma reintenta la entrega.
        return { status: 503, body: { error: "Orden en proceso, reintentar" } };
      }
      if (r.resultado === "error") {
        console.error(`[canales/webhook] ${canalId} store=${e.storeId}: no se pudo anular la venta de la orden cancelada`);
        return { status: 500, body: { error: "No se pudo procesar la cancelación" } };
      }
      return { status: 200, body: { status: "ok" } };
    }

    // 5.3: el estado del menú queda en canal_config (alerta visible para el
    // admin en /canales) en vez de solo en un console.warn.
    case "menu_rechazado":
      console.warn(`[canales/webhook] ${canalId} store=${e.storeId}: menú rechazado por la plataforma`);
      await registrarEstadoMenu(e.supabase, ctx.storeId, canalId, "rechazado", evento.detalle);
      return { status: 200, body: { status: "ok" } };

    case "menu_aprobado":
      await registrarEstadoMenu(e.supabase, ctx.storeId, canalId, "aprobado");
      return { status: 200, body: { status: "ok" } };

    case "estado_cambiado":
    case "ignorado":
      return { status: 200, body: { status: "ok" } };
  }
}
