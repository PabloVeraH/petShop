export const UBEREATS_AUTH_BASE = process.env.UBEREATS_AUTH_BASE ?? "https://login.uber.com";
export const UBEREATS_API_BASE = process.env.UBEREATS_API_BASE ?? "https://api.uber.com";

export const UBEREATS_ENDPOINTS = {
  auth: "/oauth/v2/token",
  acceptOrder: "/eats/orders/{order_id}/accept_pos_order",
  denyOrder: "/eats/orders/{order_id}/deny_pos_order",
  cancelOrder: "/eats/orders/{order_id}/cancel",
  getOrder: "/eats/orders/{order_id}",
  getOrders: "/eats/stores/{store_id}/created-orders",
  updateStatus: "/eats/orders/{order_id}/restaurantdelivery/status",
} as const;

export interface UberEatsAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface UberEatsOrder {
  uuid: string;
  order_id: string;
  external_delivery_id?: string;
  eater: {
    first_name: string;
    last_name: string;
    phone: string;
    delivery_location?: {
      address: {
        street: string;
        city: string;
      };
    };
  };
  cart_items?: {
    id: string;
    title: string;
    quantity: number;
    price: { amount: number; currency_code: string };
  }[];
  items?: {
    id: string;
    title: string;
    quantity: number;
    price: { amount: number; currency_code: string };
  }[];
  total?: { amount: number; currency_code: string };
  created_at: string;
  status: UberEatsOrderStatus;
  order_type?: string;
}

export type UberEatsOrderStatus =
  | "created"
  | "confirmed"
  | "preparing"
  | "ready_for_pickup"
  | "en_route"
  | "arrived"
  | "delivered"
  | "canceled";

export interface UberEatsCatalogItem {
  id: string;
  title: string;
  description?: string;
  price: { amount: number; currency_code: string };
  category?: string;
  is_available: boolean;
  image_url?: string;
}

export interface UberEatsWebhookEvent {
  event_type: "orders.notification" | "orders.release" | "orders.create" | "orders.status_change" | "orders.cancel";
  meta?: {
    resource_id: string;
    event_id: string;
    trigger: string;
  };
  delivery_id?: string;
  order_id?: string;
  status?: UberEatsOrderStatus;
}