/**
 * Tipos base para el Hub de Canales Multi-Plataforma
 * Define la interfaz común que implementan todos los adaptadores de canales
 */

export type CanalId = "pos" | "rappi" | "pedidosya" | "ubereats";

export type EstadoOrdenCanal =
  | "pending"      // recibida, aún no aceptada
  | "reserved"     // stock reservado, esperando aceptación
  | "accepted"     // aceptada por el operador
  | "ready"        // lista para retiro por repartidor
  | "picked_up"    // repartidor retiró el pedido
  | "delivered"    // entregado al cliente
  | "rejected"     // rechazada por el operador
  | "cancelled"    // cancelada post-aceptación
  | "expired";     // ventana de aceptación vencida

export interface CanalConfig {
  storeId: string;
  canalId: CanalId;
  externalStoreId: string;
  credentials: Record<string, string>; // ya desencriptadas
  webhookSecret?: string;
  comisionPct: number; // ej: 30 = 30%
}

export interface CanalProducto {
  productoId: string;
  precio: number;
  activo: boolean;
  categoria?: string;
  descripcionCanal?: string;
}

export interface CanalOrdenItem {
  externalProductId: string;
  productoId?: string; // mapeado desde external_product_id
  cantidad: number;
  precio: number;
}

export interface CanalOrden {
  externalOrderId: string;
  canal: CanalId;
  items: CanalOrdenItem[];
  totalExterno: number;
  rawPayload: unknown;
}

export interface IExternalChannel {
  readonly id: CanalId;
  readonly requiresWebhook: boolean;

  // Auth
  getToken(config: CanalConfig): Promise<string>;
  isTokenExpired(config: CanalConfig): boolean;

  // Catálogo
  syncCatalog(config: CanalConfig, productos: CanalProducto[]): Promise<void>;
  setAvailability(
    config: CanalConfig,
    items: { productoId: string; activo: boolean }[]
  ): Promise<void>;

  // Webhook
  validateWebhook(
    headers: Record<string, string>,
    rawBody: string,
    secret: string
  ): boolean;
  parseWebhookEvent(body: unknown): {
    type: "order" | "ping" | "status_change" | "cancellation" | "other";
    data: unknown;
  };
  parseOrder(rawOrder: unknown): CanalOrden;

  // Órdenes
  confirmOrder(config: CanalConfig, externalOrderId: string): Promise<void>;
  rejectOrder(
    config: CanalConfig,
    externalOrderId: string,
    reason?: string
  ): Promise<void>;
  updateOrderStatus(
    config: CanalConfig,
    externalOrderId: string,
    status: EstadoOrdenCanal
  ): Promise<void>;
}

// Errores especializados para canales
export class ChannelError extends Error {
  constructor(
    message: string,
    public code: number = 500,
    public channel?: CanalId
  ) {
    super(message);
    this.name = "ChannelError";
  }
}

export class WebhookValidationError extends ChannelError {
  constructor(message: string, channel?: CanalId) {
    super(message, 401, channel);
    this.name = "WebhookValidationError";
  }
}

export class TokenExpiredError extends ChannelError {
  constructor(channel?: CanalId) {
    super("Token expired", 401, channel);
    this.name = "TokenExpiredError";
  }
}
