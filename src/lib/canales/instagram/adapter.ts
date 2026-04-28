import { IExternalChannel, CanalConfig, CanalProducto, CanalOrden, ChannelError } from "../types";

export class InstagramChannel implements IExternalChannel {
  readonly id = "instagram" as const;
  readonly requiresWebhook = false;

  async getToken(config: CanalConfig): Promise<string> {
    // Placeholder for Graph API token retrieval
    // In full implementation, would use config.credentials.access_token
    // and validate/refresh via Instagram Graph API
    if (!config.credentials.access_token) {
      throw new ChannelError("Instagram access token not configured", 401, "instagram");
    }
    return config.credentials.access_token as string;
  }

  isTokenExpired(_config: CanalConfig): boolean {
    // Placeholder - token expiry managed by Graph API in full implementation
    return false;
  }

  async syncCatalog(_config: CanalConfig, _productos: CanalProducto[]): Promise<void> {
    // Placeholder - Instagram Shop catalog sync in full implementation
    // For now, product tagging is handled at post creation time
  }

  async setAvailability(_config: CanalConfig, _items: { productoId: string; activo: boolean }[]): Promise<void> {
    // Placeholder - availability management in full implementation
  }

  validateWebhook(
    headers: Record<string, string>,
    _rawBody: string,
    _secret: string
  ): boolean {
    // Placeholder HMAC validation - implement in full with Instagram's webhook signature format
    // For now, always return true since we're not receiving real webhooks yet
    return !!headers;
  }

  parseWebhookEvent(body: unknown): {
    type: "order" | "ping" | "status_change" | "cancellation" | "menu_approved" | "menu_rejected" | "store_connectivity" | "tracking" | "other";
    data: unknown;
  } {
    return { type: "other", data: body };
  }

  parseOrder(_rawOrder: unknown): CanalOrden {
    throw new ChannelError("Order parsing not supported for Instagram", 400, "instagram");
  }

  async confirmOrder(_config: CanalConfig, _externalOrderId: string): Promise<void> {
    throw new ChannelError("Order confirmation not supported for Instagram", 400, "instagram");
  }

  async rejectOrder(
    _config: CanalConfig,
    _externalOrderId: string,
    _reason?: string
  ): Promise<void> {
    throw new ChannelError("Order rejection not supported for Instagram", 400, "instagram");
  }

  async updateOrderStatus(
    _config: CanalConfig,
    _externalOrderId: string,
    _status: string
  ): Promise<void> {
    throw new ChannelError("Order status updates not supported for Instagram", 400, "instagram");
  }
}

export const instagramChannel = new InstagramChannel();
