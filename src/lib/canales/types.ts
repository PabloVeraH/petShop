/**
 * Tipos base para el Hub de Canales Multi-Plataforma
 * Define la interfaz común que implementan todos los adaptadores de canales
 */

export type CanalId = "pos" | "rappi" | "pedidosya" | "ubereats" | "instagram";

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
    type: "order" | "ping" | "status_change" | "cancellation" | "menu_approved" | "menu_rejected" | "store_connectivity" | "tracking" | "other";
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

// ============================================================
// Constantes
// ============================================================

export const CANAL_DEFAULT = "pos" as const;

export const ESTADOS_ORDEN_VALIDOS: EstadoOrdenCanal[] = [
  "pending",
  "reserved",
  "accepted",
  "ready",
  "picked_up",
  "delivered",
  "rejected",
  "cancelled",
  "expired",
];

// Ventana de aceptación por canal (en minutos)
export const VENTANA_ACEPTACION: Record<CanalId, number> = {
  pos: 0,        // inmediato
  rappi: 5,      // 5 minutos
  pedidosya: 5,  // ~5 minutos
  ubereats: 8,   // 8 minutos
  instagram: 0,  // N/A (no order-based)
};

// Cuentas contables por canal
export const CUENTAS_POR_COBRAR: Record<CanalId, string> = {
  pos: "110101",         // Caja (no aplica realmente)
  rappi: "110401",
  pedidosya: "110402",
  ubereats: "110403",
  instagram: "110404",
};

export const CUENTAS_COMISION: Record<CanalId, string> = {
  pos: "510101",
  rappi: "510101",
  pedidosya: "510102",
  ubereats: "510103",
  instagram: "510104",
};
