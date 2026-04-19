/**
 * Adaptador POS — canal presencial
 * Implementación mínima de IExternalChannel
 * POS no requiere webhook, auth, o sincronización de catálogo
 */

import { IExternalChannel, CanalConfig, CanalProducto, CanalOrden } from "../types";

export class PosChannel implements IExternalChannel {
  readonly id = "pos" as const;
  readonly requiresWebhook = false;

  // Auth: POS no requiere autenticación externa
  async getToken(_config: CanalConfig): Promise<string> {
    return "";
  }

  isTokenExpired(_config: CanalConfig): boolean {
    return false;
  }

  // Catálogo: POS no sincroniza con plataforma externa
  async syncCatalog(
    _config: CanalConfig,
    _productos: CanalProducto[]
  ): Promise<void> {
    // No-op
  }

  async setAvailability(
    _config: CanalConfig,
    _items: { productoId: string; activo: boolean }[]
  ): Promise<void> {
    // No-op
  }

  // Webhook: POS no recibe webhooks
  validateWebhook(
    _headers: Record<string, string>,
    _rawBody: string,
    _secret: string
  ): boolean {
    return false;
  }

  parseWebhookEvent(_body: unknown) {
    return { type: "other" as const, data: null };
  }

  parseOrder(_rawOrder: unknown): CanalOrden {
    throw new Error("POS does not parse orders from webhooks");
  }

  // Órdenes: POS no interactúa con órdenes en sistemas externos
  async confirmOrder(
    _config: CanalConfig,
    _externalOrderId: string
  ): Promise<void> {
    // No-op
  }

  async rejectOrder(
    _config: CanalConfig,
    _externalOrderId: string,
    _reason?: string
  ): Promise<void> {
    // No-op
  }

  async updateOrderStatus(
    _config: CanalConfig,
    _externalOrderId: string,
    _status: string
  ): Promise<void> {
    // No-op
  }
}
