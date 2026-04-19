export interface RappiAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface RappiOrder {
  order_id: string;
  store_id: string;
  customer: {
    name: string;
    phone: string;
    address?: {
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
  status: RappiOrderStatus;
}

export type RappiOrderStatus =
  | "_pending"
  | "accepted"
  | "in_progress"
  | "ready"
  | "picked_up"
  | "delivered"
  | "cancelled";

export interface RappiCatalogItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  category?: string;
  availability: boolean;
  image_url?: string;
}

export interface RappiWebhookEvent {
  event_type: "order.created" | "order.status_changed" | "order.cancelled" | "ping";
  order_id?: string;
  status?: RappiOrderStatus;
  timestamp: string;
  payload: unknown;
}

export const RAPPI_API_BASE = "https://api.rappi.com";

export const RAPPI_ENDPOINTS = {
  auth: "/oauth/token",
  catalog: "/api/v1/stores/{store_id}/products",
  orders: "/api/v1/orders",
  confirm: "/api/v1/orders/{order_id}/confirm",
  reject: "/api/v1/orders/{order_id}/reject",
  status: "/api/v1/orders/{order_id}/status",
} as const;