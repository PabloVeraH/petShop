import { z } from "zod";
import { schemaCredenciales, EXTRAS_CREDENCIALES } from "../../credenciales";

// Formato verificado contra https://dev-portal.rappi.com/en/webhook-events/ y
// /en/api-reference/orders/ (2026-09-25). Hallazgos que corrige respecto del
// adaptador anterior (src/lib/canales/rappi/adapter.ts):
//  - El cuerpo NO trae `event_type`: Rappi registra UNA URL por evento
//    (POST .../webhook {event, data:[{url, stores}]}) → el evento viaja en la
//    URL registrada (?evento=NEW_ORDER).
//  - El secreto se entrega POR EVENTO (PUT .../webhook/{EVENT}/reset-secret).
//  - NEW_ORDER: el id está en order_detail.order_id (no en la raíz) y cada
//    ítem trae sku; price = precio unitario SIN descuento,
//    unit_price_with_discount = con descuento (C3).

export const RAPPI_EVENTOS = [
  "NEW_ORDER",
  "NEW_ORDER_SCHEDULED",
  "NEW_ORDER_SCHEDULED_CANCELLED",
  "ORDER_EVENT_CANCEL",
  "ORDER_OTHER_EVENT",
  "MENU_APPROVED",
  "MENU_REJECTED",
  "PING",
  "STORE_CONNECTIVITY",
  "ORDER_RT_TRACKING",
  "STORE_PROVISIONING_STATUS",
] as const;
export type RappiEvento = (typeof RAPPI_EVENTOS)[number];

export function esRappiEvento(valor: unknown): valor is RappiEvento {
  return typeof valor === "string" && (RAPPI_EVENTOS as readonly string[]).includes(valor);
}

// client_id, client_secret, store_id, webhook_secret (+ webhook_secret_<EVENTO>
// opcionales si Rappi entrega secretos distintos por evento).
export const rappiCredencialesSchema = schemaCredenciales("rappi", EXTRAS_CREDENCIALES.rappi);

const idFlexible = z.union([z.string().min(1), z.number()]).transform(String);

const itemSchema = z
  .object({
    sku: z.string().trim().min(1, "Ítem sin sku"),
    name: z.string().optional(),
    quantity: z.number().int().positive(),
    price: z.number().nonnegative(),
    unit_price_with_discount: z.number().nonnegative().optional(),
  })
  .passthrough();

export const rappiNuevaOrdenSchema = z
  .object({
    order_detail: z
      .object({
        order_id: idFlexible,
        created_at: z.string().optional(),
        items: z.array(itemSchema).min(1, "Orden sin ítems"),
        totals: z
          .object({ total_order: z.number().nonnegative().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    store: z
      .object({
        internal_id: idFlexible.optional(),
        external_id: idFlexible.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const rappiEventoOrdenSchema = z
  .object({
    order_id: idFlexible,
    store_id: idFlexible.optional(),
    event: z.string().optional(),
  })
  .passthrough();

export const rappiMenuSchema = z
  .object({ message: z.string().optional(), reason: z.string().optional() })
  .passthrough();
