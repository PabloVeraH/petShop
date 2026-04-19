import { RAPPI_API_BASE } from "./types";
import type { RappiCancelType } from "./types";
import { getRappiToken } from "./auth";

function rappiHeaders(token: string): Record<string, string> {
  return {
    "x-authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

// Aceptar orden — PUT /orders/{orderId}/take[/{cookingTime}]
export async function confirmRappiOrder(
  storeId: string,
  orderId: string,
  cookingTimeMinutes: number = 0
): Promise<void> {
  const token = await getRappiToken(storeId);
  const base = `${RAPPI_API_BASE}/api/v2/restaurants-integrations-public-api/orders/${orderId}/take`;
  const url = cookingTimeMinutes > 0 ? `${base}/${cookingTimeMinutes}` : base;

  const response = await fetch(url, {
    method: "PUT",
    headers: rappiHeaders(token),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to confirm order ${orderId}: ${response.status} ${err}`);
  }
}

// Rechazar orden — PUT /orders/{orderId}/reject
export async function rejectRappiOrder(
  storeId: string,
  orderId: string,
  reason: string = "Store unavailable",
  cancelType: RappiCancelType = "ITEM_OUT_OF_STOCK",
  itemIds?: string[]
): Promise<void> {
  const token = await getRappiToken(storeId);

  const body: Record<string, unknown> = { reason, cancel_type: cancelType };
  if (itemIds?.length) body.items_ids = itemIds;

  const response = await fetch(
    `${RAPPI_API_BASE}/api/v2/restaurants-integrations-public-api/orders/${orderId}/reject`,
    {
      method: "PUT",
      headers: rappiHeaders(token),
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to reject order ${orderId}: ${response.status} ${err}`);
  }
}

// Notificar pedido listo para retiro — POST /orders/{orderId}/ready-for-pickup
// Máximo 3 llamadas por orden; intentos adicionales son ignorados por Rappi.
export async function notifyRappiOrderReady(
  storeId: string,
  orderId: string
): Promise<void> {
  const token = await getRappiToken(storeId);

  const response = await fetch(
    `${RAPPI_API_BASE}/api/v2/restaurants-integrations-public-api/orders/${orderId}/ready-for-pickup`,
    {
      method: "POST",
      headers: rappiHeaders(token),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to notify order ready ${orderId}: ${response.status} ${err}`);
  }
}

// Obtener eventos de una orden — GET /orders/{orderId}/events
export async function getRappiOrderEvents(
  storeId: string,
  orderId: string
): Promise<unknown[]> {
  const token = await getRappiToken(storeId);

  const response = await fetch(
    `${RAPPI_API_BASE}/api/v2/restaurants-integrations-public-api/orders/${orderId}/events`,
    {
      method: "GET",
      headers: rappiHeaders(token),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to get order events ${orderId}: ${response.status} ${err}`);
  }

  return response.json();
}
