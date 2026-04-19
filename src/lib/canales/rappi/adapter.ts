import type {
  CanalConfig,
  CanalOrden,
  CanalProducto,
  ChannelError,
  EstadoOrdenCanal,
  IExternalChannel,
  TokenExpiredError,
} from "../types";
import { verifyWebhookSignature } from "../webhook";
import { getRappiToken, isRappiTokenExpired, clearRappiToken } from "./auth";
import { confirmRappiOrder, rejectRappiOrder, updateRappiOrderStatus } from "./orders";
import type { RappiOrder, RappiWebhookEvent } from "./types";

export class RappiChannel implements IExternalChannel {
  readonly id = "rappi" as const;
  readonly requiresWebhook = true;

  async getToken(config: CanalConfig): Promise<string> {
    try {
      return await getRappiToken(config.storeId);
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        await clearRappiToken(config.storeId);
        return await getRappiToken(config.storeId);
      }
      throw error;
    }
  }

  isTokenExpired(config: CanalConfig): boolean {
    return isRappiTokenExpired(config.storeId);
  }

  async syncCatalog(
    config: CanalConfig,
    productos: CanalProducto[]
  ): Promise<void> {
    const token = await this.getToken(config);
    const items = productos.slice(0, 100).map((p) => ({
      id: p.productoId,
      name: p.descripcionCanal ?? p.productoId,
      price: p.precio,
      availability: p.activo,
    }));

    const response = await fetch(`https://api.rappi.com/api/v1/stores/${config.externalStoreId}/products/bulk`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ products: items }),
    });

    if (!response.ok) {
      throw new ChannelError("Failed to sync catalog", 500, "rappi");
    }
  }

  async setAvailability(
    config: CanalConfig,
    items: { productoId: string; activo: boolean }[]
  ): Promise<void> {
    const token = await this.getToken(config);
    const payload = items.map((item) => ({
      id: item.productoId,
      availability: item.activo,
    }));

    const response = await fetch(`https://api.rappi.com/api/v1/stores/${config.externalStoreId}/availability`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ products: payload }),
    });

    if (!response.ok) {
      throw new ChannelError("Failed to update availability", 500, "rappi");
    }
  }

  validateWebhook(
    headers: Record<string, string>,
    rawBody: string,
    secret: string
  ): boolean {
    const signature = headers["x-rappi-signature"] ?? headers["X-Rappi-Signature"];
    if (!signature) return false;
    return verifyWebhookSignature(rawBody, signature, secret);
  }

  parseWebhookEvent(body: unknown): {
    type: "order" | "ping" | "status_change" | "cancellation" | "other";
    data: unknown;
  } {
    const event = body as RappiWebhookEvent;

    switch (event.event_type) {
      case "order.created":
        return { type: "order", data: event };
      case "order.status_changed":
        return { type: "status_change", data: event };
      case "order.cancelled":
        return { type: "cancellation", data: event };
      case "ping":
        return { type: "ping", data: event };
      default:
        return { type: "other", data: event };
    }
  }

  parseOrder(rawOrder: unknown): CanalOrden {
    const order = rawOrder as RappiOrder;

    return {
      externalOrderId: order.order_id,
      canal: "rappi",
      items: order.items.map((item) => ({
        externalProductId: item.id,
        cantidad: item.quantity,
        precio: item.unit_price,
      })),
      totalExterno: order.total,
      rawPayload: order,
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
    const statusMap: Record<EstadoOrdenCanal, "accepted" | "in_progress" | "ready"> = {
      accepted: "accepted",
      ready: "in_progress",
      picked_up: "ready",
      delivered: "delivered",
      rejected: "cancelled",
      cancelled: "cancelled",
      pending: "accepted",
      reserved: "accepted",
      expired: "cancelled",
    };

    const rappiStatus = statusMap[status];
    if (rappiStatus) {
      await updateRappiOrderStatus(config.storeId, externalOrderId, rappiStatus);
    }
  }
}

export const rappiChannel = new RappiChannel();