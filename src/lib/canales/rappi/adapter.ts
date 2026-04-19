import { createHmac, timingSafeEqual } from "crypto";
import type {
  CanalConfig,
  CanalOrden,
  CanalProducto,
  EstadoOrdenCanal,
  IExternalChannel,
} from "../types";
import { ChannelError } from "../types";
import { getRappiToken } from "./auth";
import { confirmRappiOrder, rejectRappiOrder, notifyRappiOrderReady } from "./orders";
import { syncRappiCatalog, setRappiAvailability } from "./catalog";
import type { RappiOrder, RappiWebhookEvent, RappiMenuItem } from "./types";

export class RappiChannel implements IExternalChannel {
  readonly id = "rappi" as const;
  readonly requiresWebhook = true;

  async getToken(config: CanalConfig): Promise<string> {
    return getRappiToken(config.storeId);
  }

  isTokenExpired(_config: CanalConfig): boolean {
    // La verificación real está en auth.ts (cache con buffer 24h)
    return false;
  }

  async syncCatalog(config: CanalConfig, productos: CanalProducto[]): Promise<void> {
    const storeIntegrationId = config.externalStoreId;
    if (!storeIntegrationId) {
      throw new ChannelError("Rappi externalStoreId (integrationId) no configurado", 500, "rappi");
    }

    const items: RappiMenuItem[] = productos.map((p, idx) => ({
      name: p.descripcionCanal ?? p.productoId,
      description: p.descripcionCanal ?? p.productoId,
      sku: p.productoId,           // usar SKU real del producto cuando esté disponible
      type: "PRODUCT" as const,
      price: Math.round(p.precio), // entero en pesos
      sortingPosition: idx,
      category: {
        id: p.categoria ?? "general",
        name: p.categoria ?? "General",
        minQty: 0,
        maxQty: 999,
        sortingPosition: 0,
      },
      children: [],
    }));

    await syncRappiCatalog(config.storeId, storeIntegrationId, items);
  }

  async setAvailability(
    config: CanalConfig,
    items: { productoId: string; activo: boolean }[]
  ): Promise<void> {
    const storeIntegrationId = config.externalStoreId;
    if (!storeIntegrationId) {
      throw new ChannelError("Rappi externalStoreId (integrationId) no configurado", 500, "rappi");
    }

    await setRappiAvailability(
      config.storeId,
      storeIntegrationId,
      items.map(i => ({ sku: i.productoId, activo: i.activo }))
    );
  }

  // Valida la firma del webhook de Rappi.
  // Header: Rappi-Signature: t=<timestamp>,sign=<hmac-sha256>
  // Payload firmado: "<timestamp>.<rawBody>"
  validateWebhook(
    headers: Record<string, string>,
    rawBody: string,
    secret: string
  ): boolean {
    const sigHeader = headers["rappi-signature"] ?? headers["Rappi-Signature"];
    if (!sigHeader || !secret) return false;

    const parts: Record<string, string> = {};
    for (const segment of sigHeader.split(",")) {
      const [k, v] = segment.split("=");
      if (k && v) parts[k.trim()] = v.trim();
    }

    const timestamp = parts["t"];
    const receivedSign = parts["sign"];
    if (!timestamp || !receivedSign) return false;

    // Anti-replay: rechazar si el timestamp tiene más de 5 minutos
    const ageSecs = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (ageSecs > 300) return false;

    const signedPayload = `${timestamp}.${rawBody}`;
    const expectedSign = createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");

    try {
      const receivedBuf = Buffer.from(receivedSign, "utf8");
      const expectedBuf = Buffer.from(expectedSign, "utf8");
      if (receivedBuf.length !== expectedBuf.length) return false;
      return timingSafeEqual(receivedBuf, expectedBuf);
    } catch {
      return false;
    }
  }

  parseWebhookEvent(body: unknown): {
    type: "order" | "ping" | "status_change" | "cancellation" | "menu_approved" | "menu_rejected" | "store_connectivity" | "tracking" | "other";
    data: unknown;
  } {
    const event = body as RappiWebhookEvent;

    switch (event.event_type) {
      case "NEW_ORDER":          return { type: "order", data: event };
      case "ORDER_EVENT_CANCEL": return { type: "cancellation", data: event };
      case "ORDER_OTHER_EVENT":  return { type: "status_change", data: event };
      case "PING":               return { type: "ping", data: event };
      case "MENU_APPROVED":      return { type: "menu_approved", data: event };
      case "MENU_REJECTED":      return { type: "menu_rejected", data: event };
      case "STORE_CONNECTIVITY": return { type: "store_connectivity", data: event };
      case "ORDER_RT_TRACKING":  return { type: "tracking", data: event };
      default:                   return { type: "other", data: event };
    }
  }

  parseOrder(rawOrder: unknown): CanalOrden {
    const order = rawOrder as RappiWebhookEvent & { order_detail?: RappiOrder["order_detail"]; order_id?: string; store_id?: string };
    const detail = order.order_detail as RappiOrder["order_detail"] | undefined;

    return {
      externalOrderId: String(order.order_id ?? ""),
      canal: "rappi",
      items: (detail?.items ?? []).map((item) => ({
        externalProductId: item.id,
        cantidad: item.quantity,
        precio: item.price,
      })),
      totalExterno: detail?.total_order ?? 0,
      rawPayload: rawOrder,
    };
  }

  async confirmOrder(config: CanalConfig, externalOrderId: string): Promise<void> {
    await confirmRappiOrder(config.storeId, externalOrderId);
  }

  async rejectOrder(
    config: CanalConfig,
    externalOrderId: string,
    reason?: string
  ): Promise<void> {
    await rejectRappiOrder(config.storeId, externalOrderId, reason);
  }

  async updateOrderStatus(
    config: CanalConfig,
    externalOrderId: string,
    status: EstadoOrdenCanal
  ): Promise<void> {
    // Rappi solo acepta notificación de "listo para retiro".
    // Los demás cambios de estado los gestiona Rappi internamente.
    if (status === "ready") {
      await notifyRappiOrderReady(config.storeId, externalOrderId);
    }
  }
}

export const rappiChannel = new RappiChannel();
