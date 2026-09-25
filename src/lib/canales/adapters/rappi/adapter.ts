import { createHmac, timingSafeEqual } from "crypto";
import type { EventoCanal, MotivoRechazo } from "../../domain/types";
import {
  PayloadInvalidoError,
  type ChannelAdapter,
  type ChannelContext,
  type ItemCatalogo,
  type ItemDisponibilidad,
  type WebhookRequest,
} from "../port";
import {
  esRappiEvento,
  rappiCredencialesSchema,
  rappiEventoOrdenSchema,
  rappiMenuSchema,
  rappiNuevaOrdenSchema,
  type RappiEvento,
} from "./schemas";
import { rappiFetch } from "./client";

// Ventana anti-replay del header Rappi-Signature. La documentación no fija
// una tolerancia: 5 minutos es un supuesto a confirmar en el sandbox.
export const RAPPI_TOLERANCIA_FIRMA_SEG = 300;

// Minutos de preparación informados al aceptar (PUT orders/{id}/take/{min}).
const TIEMPO_PREPARACION_MIN = 10;

const CANCEL_TYPE: Record<MotivoRechazo, string> = {
  ITEM_NOT_FOUND: "ITEM_NOT_FOUND",
  ITEM_OUT_OF_STOCK: "ITEM_OUT_OF_STOCK",
  STORE_CLOSED: "ORDER_MISSING_INFORMATION",
  OTHER: "ORDER_MISSING_INFORMATION",
};

const RAZON: Record<MotivoRechazo, string> = {
  ITEM_NOT_FOUND: "Producto no disponible en la tienda",
  ITEM_OUT_OF_STOCK: "Producto sin stock",
  STORE_CLOSED: "Tienda sin disponibilidad",
  OTHER: "No se pudo procesar la orden",
};

function parsearJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new PayloadInvalidoError("Cuerpo JSON inválido");
  }
}

function primerError(error: { issues: { message: string; path: PropertyKey[] }[] }): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "payload"}: ${issue.message}` : "payload inválido";
}

// Secreto del evento: webhook_secret_<EVENTO> si existe, si no el general.
export function secretoRappi(credentials: Record<string, string>, evento: string): string {
  return credentials[`webhook_secret_${evento}`] || credentials.webhook_secret || "";
}

// Header Rappi-Signature: "t=<timestamp>,sign=<hex>"; firmado
// "<timestamp>.<cuerpo>" con HMAC-SHA256 (hex) y el secreto del webhook.
export function firmaRappiValida(
  header: string | null,
  rawBody: string,
  secreto: string,
  ahoraMs: number
): boolean {
  if (!header || !secreto) return false;
  const partes: Record<string, string> = {};
  for (const segmento of header.split(",")) {
    const i = segmento.indexOf("=");
    if (i > 0) partes[segmento.slice(0, i).trim()] = segmento.slice(i + 1).trim();
  }
  const t = partes.t;
  const firma = partes.sign;
  if (!t || !firma || !/^\d+$/.test(t) || !/^[0-9a-f]+$/i.test(firma)) return false;

  // Anti-replay (supuesto: t en segundos).
  if (Math.abs(ahoraMs / 1000 - Number(t)) > RAPPI_TOLERANCIA_FIRMA_SEG) return false;

  const esperada = createHmac("sha256", secreto).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(firma.toLowerCase(), "utf8");
  const b = Buffer.from(esperada, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function idsTienda(...ids: (string | undefined)[]): string[] {
  return ids.filter((x): x is string => !!x);
}

export class RappiAdapter implements ChannelAdapter {
  readonly id = "rappi" as const;
  readonly capabilities = {
    availabilityMode: "toggle" as const,     // API de restaurantes: solo on/off
    supportsReadyForPickup: true,
    acceptanceWindowMin: 5,
    eventoEnUrl: true,
  };
  readonly credentialsSchema = rappiCredencialesSchema;

  verifyWebhook(req: WebhookRequest, ctx: ChannelContext, ahoraMs = Date.now()): boolean {
    if (!esRappiEvento(req.evento)) return false;
    return firmaRappiValida(
      req.headers.get("rappi-signature"),
      req.rawBody,
      secretoRappi(ctx.credentials, req.evento),
      ahoraMs
    );
  }

  parseEvent(req: WebhookRequest): EventoCanal {
    if (!esRappiEvento(req.evento)) {
      throw new PayloadInvalidoError("Evento de Rappi desconocido o ausente en la URL");
    }
    const evento: RappiEvento = req.evento;
    const body = parsearJson(req.rawBody);

    switch (evento) {
      case "NEW_ORDER": {
        const r = rappiNuevaOrdenSchema.safeParse(body);
        if (!r.success) throw new PayloadInvalidoError(primerError(r.error));
        const d = r.data.order_detail;
        const items = d.items.map((it) => ({
          sku: it.sku,
          nombre: it.name,
          cantidad: it.quantity,
          precioUnitarioBruto: it.unit_price_with_discount ?? it.price,
        }));
        return {
          tipo: "orden_creada",
          orden: {
            externalOrderId: d.order_id,
            externalStoreIds: idsTienda(r.data.store?.internal_id, r.data.store?.external_id),
            items,
            totalBruto:
              d.totals?.total_order ??
              items.reduce((s, i) => s + i.precioUnitarioBruto * i.cantidad, 0),
            creadaEn: d.created_at ?? null,
          },
        };
      }
      case "ORDER_EVENT_CANCEL":
      case "NEW_ORDER_SCHEDULED_CANCELLED": {
        const r = rappiEventoOrdenSchema.safeParse(body);
        if (!r.success) throw new PayloadInvalidoError(primerError(r.error));
        return {
          tipo: "orden_cancelada",
          externalOrderId: r.data.order_id,
          externalStoreIds: idsTienda(r.data.store_id),
          motivo: r.data.event,
        };
      }
      case "ORDER_OTHER_EVENT": {
        const r = rappiEventoOrdenSchema.safeParse(body);
        if (!r.success) throw new PayloadInvalidoError(primerError(r.error));
        return {
          tipo: "estado_cambiado",
          externalOrderId: r.data.order_id,
          externalStoreIds: idsTienda(r.data.store_id),
          estadoExterno: r.data.event ?? "desconocido",
        };
      }
      case "PING":
        return { tipo: "ping" };
      case "MENU_APPROVED":
        return { tipo: "menu_aprobado" };
      case "MENU_REJECTED": {
        const r = rappiMenuSchema.safeParse(body);
        return { tipo: "menu_rechazado", detalle: r.success ? (r.data.reason ?? r.data.message) : undefined };
      }
      // Órdenes programadas: la decisión de cuándo descontar stock (al
      // recibir o a la hora programada) es de la Fase 3 → por ahora se
      // registran como ignoradas en vez de crear una orden.
      case "NEW_ORDER_SCHEDULED":
      case "STORE_CONNECTIVITY":
      case "ORDER_RT_TRACKING":
      case "STORE_PROVISIONING_STATUS":
        return { tipo: "ignorado", tipoExterno: evento };
    }
  }

  // Respuesta exigida por Rappi al PING (cada 3 min): status "OK" o la
  // tienda se considera no disponible.
  pingResponse() {
    return { status: 200, body: { status: "OK", description: "Store on" } };
  }

  async confirmOrder(ctx: ChannelContext, externalOrderId: string): Promise<void> {
    await rappiFetch(ctx, "PUT", `/orders/${encodeURIComponent(externalOrderId)}/take/${TIEMPO_PREPARACION_MIN}`);
  }

  async rejectOrder(ctx: ChannelContext, externalOrderId: string, motivo: MotivoRechazo): Promise<void> {
    await rappiFetch(ctx, "PUT", `/orders/${encodeURIComponent(externalOrderId)}/reject`, {
      reason: RAZON[motivo],
      cancel_type: CANCEL_TYPE[motivo],
    });
  }

  async markReady(ctx: ChannelContext, externalOrderId: string): Promise<void> {
    await rappiFetch(ctx, "POST", `/orders/${encodeURIComponent(externalOrderId)}/ready-for-pickup`);
  }

  async pushCatalog(ctx: ChannelContext, items: ItemCatalogo[]): Promise<void> {
    await rappiFetch(ctx, "POST", "/menu", {
      storeId: ctx.externalStoreId,
      items: items.map((it, idx) => ({
        name: it.nombre,
        description: it.descripcion ?? it.nombre,
        sku: it.sku,
        type: "PRODUCT",
        price: Math.round(it.precioBruto),
        imageUrl: it.imagenUrl ?? undefined,
        sortingPosition: idx,
        category: {
          id: it.categoria ?? "general",
          name: it.categoria ?? "General",
          minQty: 0,
          maxQty: 999,
          sortingPosition: 0,
        },
        children: [],
      })),
    });
  }

  async pushAvailability(ctx: ChannelContext, items: ItemDisponibilidad[]): Promise<void> {
    await rappiFetch(ctx, "PUT", "/availability/stores/items", [
      {
        store_integration_id: ctx.externalStoreId,
        items: {
          turn_on: items.filter((i) => i.disponible).map((i) => i.sku),
          turn_off: items.filter((i) => !i.disponible).map((i) => i.sku),
        },
      },
    ]);
  }
}
