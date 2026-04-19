import { RAPPI_API_BASE, RAPPI_ENDPOINTS } from "./types";
import { getRappiToken, isRappiTokenExpired } from "./auth";

export async function confirmRappiOrder(
  storeId: string,
  orderId: string
): Promise<void> {
  if (isRappiTokenExpired(storeId)) {
    throw new Error("Rappi token expired");
  }

  const token = await getRappiToken(storeId);
  const endpoint = RAPPI_ENDPOINTS.confirm.replace("{order_id}", orderId);

  const response = await fetch(`${RAPPI_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to confirm order ${orderId}: ${err}`);
  }
}

export async function rejectRappiOrder(
  storeId: string,
  orderId: string,
  reason: string = "Store unavailable"
): Promise<void> {
  if (isRappiTokenExpired(storeId)) {
    throw new Error("Rappi token expired");
  }

  const token = await getRappiToken(storeId);
  const endpoint = RAPPI_ENDPOINTS.reject.replace("{order_id}", orderId);

  const response = await fetch(`${RAPPI_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to reject order ${orderId}: ${err}`);
  }
}

export async function updateRappiOrderStatus(
  storeId: string,
  orderId: string,
  status: "accepted" | "in_progress" | "ready"
): Promise<void> {
  if (isRappiTokenExpired(storeId)) {
    throw new Error("Rappi token expired");
  }

  const token = await getRappiToken(storeId);
  const endpoint = RAPPI_ENDPOINTS.status.replace("{order_id}", orderId);

  const response = await fetch(`${RAPPI_API_BASE}${endpoint}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to update order status: ${err}`);
  }
}