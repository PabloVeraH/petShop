import type {
  CanalConfig,
  CanalOrden,
  CanalProducto,
  ChannelError,
  EstadoOrdenCanal,
  IExternalChannel,
} from "../types";
import { verifyWebhookSignature } from "../webhook";
import { getUberEatsToken, isUberEatsTokenExpired, clearUberEatsToken } from "./auth";
import { confirmUberEatsOrder, cancelUberEatsOrder, updateUberEatsOrderStatus } from "./orders";
import type { UberEatsOrder, UberEatsWebhookEvent } from "./types";

export class UberEatsChannel implements IExternalChannel {
  readonly id = "ubereats" as const;
  readonly requiresWebhook = true;

  async getToken(config: CanalConfig): Promise<string> {
    try {
      return await getUberEatsToken(config.storeId);
    } catch {
      await clearUberEatsToken(config.storeId);
      return await getUberEatsToken(config.storeId);
    }
  }

  isTokenExpired(config: CanalConfig): boolean {
    return isUberEatsTokenExpired(config.storeId);
  }

  async syncCatalog(
    config: CanalConfig,
    productos: CanalProducto[]
  ): Promise<void> {
    const token = await this.getToken(config);
    const items = productos.slice(0, 100).map((p) => ({
      id: p.productoId,
      title: p.descripcionCanal ?? p.productoId,
      price: { amount: p.precio, currency_code: "CLP" },
      is_available: p.activo,
    }));

    const response = await fetch(`https://api.uber.com/eats/v2/business/${config.externalStoreId}/items`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items }),
    });

    if (!response.ok) {
      throw new ChannelError("Failed to sync catalog", 500, "ubereats");
    }
  }

  async setAvailability(
    config: CanalConfig,
    items: { productoId: string; activo: boolean }[]
  ): Promise<void> {
    const token = await this.getToken(config);
    const payload = items.map((item) => ({
      id: item.productoId,
      is_available: item.activo,
    }));

    const response = await fetch(`https://api.uber.com/eats/v2/business/${config.externalStoreId}/items/availability`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items: payload }),
    });

    if (!response.ok) {
      throw new ChannelError("Failed to update availability", 500, "ubereats");
    }
  }

  validateWebhook(
    headers: Record<string, string>,
    rawBody: string,
    secret: string
  ): boolean {
    const signature = headers["x-ubereats-signature"] ?? headers["X-UberEats-Signature"];
    if (!signature) return false;
    return verifyWebhookSignature(rawBody, signature, secret);
  }

  parseWebhookEvent(body: unknown): {
    type: "order" | "ping" | "status_change" | "cancellation" | "other";
    data: unknown;
  } {
    const event = body as UberEatsWebhookEvent;

    switch (event.event_type) {
      case "orders.create":
        return { type: "order", data: event };
      case "orders.status_change":
        return { type: "status_change", data: event };
      case "orders.cancel":
        return { type: "cancellation", data: event };
      default:
        return { type: "other", data: event };
    }
  }

  parseOrder(rawOrder: unknown): CanalOrden {
    const order = rawOrder as UberEatsOrder;

    return {
      externalOrderId: order.uuid,
      canal: "ubereats",
      items: order.cart_items.map((item) => ({
        externalProductId: item.id,
        cantidad: item.quantity,
        precio: item.price.amount,
      })),
      totalExterno: order.total.amount,
      rawPayload: order,
    };
  }

  async confirmOrder(config: CanalConfig, externalOrderId: string): Promise<void> {
    await confirmUberEatsOrder(config.storeId, externalOrderId);
  }

  async rejectOrder(
    config: CanalConfig,
    externalOrderId: string,
    reason?: string
  ): Promise<void> {
    await cancelUberEatsOrder(config.storeId, externalOrderId, reason);
  }

  async updateOrderStatus(
    config: CanalConfig,
    externalOrderId: string,
    status: EstadoOrdenCanal
  ): Promise<void> {
    const statusMap: Record<EstadoOrdenCanal, "confirmed" | "preparing" | "ready_for_pickup"> = {
      accepted: "confirmed",
      ready: "preparing",
      picked_up: "ready_for_pickup",
      delivered: "delivered",
      rejected: "canceled",
      cancelled: "canceled",
      pending: "confirmed",
      reserved: "confirmed",
      expired: "canceled",
    };

    const ueStatus = statusMap[status];
    if (ueStatus) {
      await updateUberEatsOrderStatus(config.storeId, externalOrderId, ueStatus);
    }
  }
}

export const ubereatsChannel = new UberEatsChannel();