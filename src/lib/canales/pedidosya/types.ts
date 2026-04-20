export interface PedidosYaAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface PedidosYaOrder {
  id: string;
  external_id: string;
  store_id: string;
  consumer: {
    name: string;
    phone: string;
    address: {
      street: string;
      number?: string;
      city?: string;
    };
  };
  items: {
    id: string;
    name: string;
    quantity: number;
    unit_price: number;
    total: number;
  }[];
  total: number;
  delivery_fee?: number;
  service_fee?: number;
  created_at: string;
  status: PedidosYaOrderStatus;
}

export type PedidosYaOrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

export interface PedidosYaCatalogItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  category?: string;
  availability: boolean;
  image_url?: string;
}

export interface PedidosYaWebhookEvent {
  event_type: "order.created" | "order.status_changed" | "order.cancelled" | "ping";
  order_id?: string;
  status?: PedidosYaOrderStatus;
  timestamp: string;
  payload: unknown;
}

export const PEDIDOSYA_AUTH_BASE = process.env.PEDIDOSYA_AUTH_BASE ?? "https://pedidosya.partner.deliveryhero.io";
export const PEDIDOSYA_API_BASE = process.env.PEDIDOSYA_API_BASE ?? "https://api.pedidosya.com";

export const PEDIDOSYA_ENDPOINTS = {
  auth: "/v2/oauth/token",
  catalog: "/v1/stores/{store_id}/products",
  orders: "/v1/orders",
  confirm: "/v1/orders/{order_id}/confirm",
  reject: "/v1/orders/{order_id}/reject",
  status: "/v1/orders/{order_id}/status",
} as const;