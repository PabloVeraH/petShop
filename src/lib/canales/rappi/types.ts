export const RAPPI_AUTH_BASE = process.env.RAPPI_AUTH_BASE ?? "https://api.dev.rappi.com";
export const RAPPI_API_BASE = process.env.RAPPI_API_BASE ?? "https://microservices.dev.rappi.com";

export const RAPPI_ENDPOINTS = {
  auth:                  "/restaurants/auth/v1/token/login/integrations",
  stores:                "/api/v2/restaurants-integrations-public-api/stores-pa",
  menu:                  "/api/v2/restaurants-integrations-public-api/menu",
  menuApproved:          "/api/v2/restaurants-integrations-public-api/menu/approved/{store_id}",
  menuRappi:             "/api/v2/restaurants-integrations-public-api/menu/rappi/{store_id}",
  orders:                "/api/v2/restaurants-integrations-public-api/orders",
  ordersTake:            "/api/v2/restaurants-integrations-public-api/orders/{order_id}/take",
  ordersTakeCooking:     "/api/v2/restaurants-integrations-public-api/orders/{order_id}/take/{cooking_time}",
  ordersReject:          "/api/v2/restaurants-integrations-public-api/orders/{order_id}/reject",
  ordersReady:           "/api/v2/restaurants-integrations-public-api/orders/{order_id}/ready-for-pickup",
  ordersEvents:          "/api/v2/restaurants-integrations-public-api/orders/{order_id}/events",
  availabilityItems:     "/api/v2/restaurants-integrations-public-api/availability/stores/items",
  availabilityItemStatus:"/api/v2/restaurants-integrations-public-api/availability/items/status",
  availabilityStores:    "/api/v2/restaurants-integrations-public-api/availability/stores",
  webhook:               "/api/v2/restaurants-integrations-public-api/webhook",
} as const;

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface RappiAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // 86400 (1 día) o 604800 (7 días) según endpoint
}

// ── Stores ────────────────────────────────────────────────────────────────────

export interface RappiStoreInfo {
  integrationId: string; // usar como store_integration_id en availability y menú
  rappiId: string;
  name: string;
}

// ── Orders ────────────────────────────────────────────────────────────────────

export type RappiCancelType =
  | "ITEM_WRONG_PRICE"
  | "ITEM_NOT_FOUND"
  | "ITEM_OUT_OF_STOCK"
  | "ORDER_MISSING_INFORMATION"
  | "ORDER_MISSING_ADDRESS_INFORMATION"
  | "ORDER_TOTAL_INCORRECT";

export interface RappiOrderItem {
  id: string;        // SKU del producto
  name: string;
  price: number;
  quantity: number;
  topping: unknown[];
}

export interface RappiOrder {
  order_id: string;
  store_id: string;
  order_detail: {
    items: RappiOrderItem[];
    total_products: number;
    total_discount: number;
    total_order: number;
  };
  customer: {
    id: number;
    name: string;
    last_name: string;
    address: string;
    phone: string;
  };
  store: {
    id: string;
    name: string;
  };
  created_at: string;
  state: string;
}

// ── Menu / Catalog ────────────────────────────────────────────────────────────

export interface RappiMenuCategory {
  id: string;
  name: string;
  minQty: number;
  maxQty: number;
  sortingPosition: number;
}

export interface RappiMenuTopping {
  name: string;
  description: string;
  sku: string;
  type: "TOPPING";
  price: number;
  sortingPosition: number;
  maxLimit: number;
  category: RappiMenuCategory;
  children: [];
}

export interface RappiMenuItem {
  name: string;
  description: string;
  sku: string;
  type: "PRODUCT";
  price: number;           // entero (pesos)
  imageUrl?: string;
  sortingPosition?: number;
  combo?: boolean;
  category: RappiMenuCategory;
  children?: RappiMenuTopping[];
}

export interface RappiMenuPayload {
  storeId: string;         // integrationId de la tienda
  items: RappiMenuItem[];
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

export type RappiEventType =
  | "NEW_ORDER"
  | "ORDER_EVENT_CANCEL"
  | "ORDER_OTHER_EVENT"
  | "MENU_APPROVED"
  | "MENU_REJECTED"
  | "PING"
  | "STORE_CONNECTIVITY"
  | "ORDER_RT_TRACKING";

export interface RappiWebhookEvent {
  event_type: RappiEventType;
  [key: string]: unknown;
}
