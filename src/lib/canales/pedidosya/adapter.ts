import type {
  CanalConfig,
  CanalOrden,
  CanalProducto,
  ChannelError,
  EstadoOrdenCanal,
  IExternalChannel,
} from "../types";
import { verifyWebhookSignature } from "../webhook";
import { getPedidosYaToken, isPedidosYaTokenExpired, clearPedidosYaToken } from "./auth";
import { confirmPedidosYaOrder, rejectPedidosYaOrder, updatePedidosYaOrderStatus } from "./orders";
import type { PedidosYaOrder, PedidosYaWebhookEvent } from "./types";

export class PedidosYaChannel implements IExternalChannel {
  readonly id = "pedidosya" as const;
  readonly requiresWebhook = true;

  async getToken(config: CanalConfig): Promise<string> {
    try {
      return await getPedidosYaToken(config.storeId);
    } catch {
      await clearPedidosYaToken(config.storeId);
      return await getPedidosYaToken(config.storeId);
    }
  }

  isTokenExpired(config: CanalConfig): boolean {
    return isPedidosYaTokenExpired(config.storeId);
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

    const response = await fetch(`https://api.pedidosya.com/v1/stores/${config.externalStoreId}/products/bulk`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ products: items }),
    });

    if (!response.ok) {
      throw new ChannelError("Failed to sync catalog", 500, "pedidosya");
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

    const response = await fetch(`https://api.pedidosya.com/v1/stores/${config.externalStoreId}/availability`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ products: payload }),
    });

    if (!response.ok) {
      throw new ChannelError("Failed to update availability", 500, "pedidosya");
    }
  }

  validateWebhook(
    headers: Record<string, string>,
    rawBody: string,
    secret: string
  ): boolean {
    const signature = headers["x-pedidosya-signature"] ?? headers["X-PedidosYa-Signature"];
    if (!signature) return false;
    return verifyWebhookSignature(rawBody, signature, secret);
  }

  parseWebhookEvent(body: unknown): {
    type: "order" | "ping" | "status_change" | "cancellation" | "other";
    data: unknown;
  } {
    const event = body as PedidosYaWebhookEvent;

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
    const order = rawOrder as PedidosYaOrder;

    return {
      externalOrderId: order.id,
      canal: "pedidosya",
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
    await confirmPedidosYaOrder(config.storeId, externalOrderId);
  }

  async rejectOrder(
    config: CanalConfig,
    externalOrderId: string,
    reason?: string
  ): Promise<void> {
    await rejectPedidosYaOrder(config.storeId, externalOrderId, reason);
  }

  async updateOrderStatus(
    config: CanalConfig,
    externalOrderId: string,
    status: EstadoOrdenCanal
  ): Promise<void> {
    const statusMap: Record<EstadoOrdenCanal, "confirmed" | "preparing" | "ready"> = {
      accepted: "confirmed",
      ready: "preparing",
      picked_up: "ready",
      delivered: "delivered",
      rejected: "cancelled",
      cancelled: "cancelled",
      pending: "confirmed",
      reserved: "confirmed",
      expired: "cancelled",
    };

    const pyStatus = statusMap[status];
    if (pyStatus) {
      await updatePedidosYaOrderStatus(config.storeId, externalOrderId, pyStatus);
    }
  }
}

export const pedidosyaChannel = new PedidosYaChannel();