import { UBEREATS_API_BASE, UBEREATS_ENDPOINTS } from "./types";
import { getUberEatsToken, isUberEatsTokenExpired } from "./auth";

export async function acceptUberEatsOrder(
  storeId: string,
  orderId: string
): Promise<void> {
  if (isUberEatsTokenExpired(storeId)) {
    throw new Error("UberEats token expired");
  }

  const token = await getUberEatsToken(storeId);
  const endpoint = UBEREATS_ENDPOINTS.acceptOrder.replace("{order_id}", orderId);

  const response = await fetch(`${UBEREATS_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to accept order ${orderId}: ${err}`);
  }
}

export async function denyUberEatsOrder(
  storeId: string,
  orderId: string,
  reason: string = "Store unavailable"
): Promise<void> {
  if (isUberEatsTokenExpired(storeId)) {
    throw new Error("UberEats token expired");
  }

  const token = await getUberEatsToken(storeId);
  const endpoint = UBEREATS_ENDPOINTS.denyOrder.replace("{order_id}", orderId);

  const response = await fetch(`${UBEREATS_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to deny order ${orderId}: ${err}`);
  }
}

export async function cancelUberEatsOrder(
  storeId: string,
  orderId: string
): Promise<void> {
  if (isUberEatsTokenExpired(storeId)) {
    throw new Error("UberEats token expired");
  }

  const token = await getUberEatsToken(storeId);
  const endpoint = UBEREATS_ENDPOINTS.cancelOrder.replace("{order_id}", orderId);

  const response = await fetch(`${UBEREATS_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to cancel order ${orderId}: ${err}`);
  }
}

export async function updateUberEatsOrderStatus(
  storeId: string,
  orderId: string,
  status: "preparing" | "ready_for_pickup" | "en_route" | "arrived"
): Promise<void> {
  if (isUberEatsTokenExpired(storeId)) {
    throw new Error("UberEats token expired");
  }

  const token = await getUberEatsToken(storeId);
  const endpoint = UBEREATS_ENDPOINTS.updateStatus.replace("{order_id}", orderId);

  const response = await fetch(`${UBEREATS_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status,
      estimated_pickup_time: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to update order status: ${err}`);
  }
}