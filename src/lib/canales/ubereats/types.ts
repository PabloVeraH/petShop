export interface UberEatsAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface UberEatsOrder {
  uuid: string;
  external_delivery_id: string;
  eater: {
    first_name: string;
    last_name: string;
    phone: string;
    delivery_location: {
      address: {
        street: string;
        city: string;
      };
    };
  };
  cart_items: {
    id: string;
    title: string;
    quantity: number;
    price: { amount: number; currency_code: string };
  }[];
  total: { amount: number; currency_code: string };
  created_at: string;
  status: UberEatsOrderStatus;
  order_type: string;
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
  event_type: "orders.create" | "orders.status_change" | "orders.cancel";
  occurrence: {
    delivery_id: string;
    status: UberEatsOrderStatus;
    occurred_at: string;
  };
  meta: {
    event_id: string;
    resource_id: string;
    trigger: string;
  };
}

export const UBEREATS_API_BASE = "https://api.uber.com/eats/v2";

export const UBEREATS_ENDPOINTS = {
  auth: "/oauth/token",
  confirm: "/deliveries/{delivery_id}/confirm",
  cancel: "/deliveries/{delivery_id}/cancel",
  update: "/deliveries/{delivery_id}/status",
} as const;