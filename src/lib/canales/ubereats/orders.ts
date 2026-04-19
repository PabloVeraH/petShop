import { UBEREATS_API_BASE, UBEREATS_ENDPOINTS } from "./types";
import { getUberEatsToken, isUberEatsTokenExpired } from "./auth";

export async function confirmUberEatsOrder(
  storeId: string,
  deliveryId: string
): Promise<void> {
  if (isUberEatsTokenExpired(storeId)) {
    throw new Error("UberEats token expired");
  }

  const token = await getUberEatsToken(storeId);
  const endpoint = UBEREATS_ENDPOINTS.confirm.replace("{delivery_id}", deliveryId);

  const response = await fetch(`${UBEREATS_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to confirm delivery ${deliveryId}: ${err}`);
  }
}

export async function cancelUberEatsOrder(
  storeId: string,
  deliveryId: string,
  reason: string = "Store unavailable"
): Promise<void> {
  if (isUberEatsTokenExpired(storeId)) {
    throw new Error("UberEats token expired");
  }

  const token = await getUberEatsToken(storeId);
  const endpoint = UBEREATS_ENDPOINTS.cancel.replace("{delivery_id}", deliveryId);

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
    throw new Error(`Failed to cancel delivery ${deliveryId}: ${err}`);
  }
}

export async function updateUberEatsOrderStatus(
  storeId: string,
  deliveryId: string,
  status: "confirmed" | "preparing" | "ready_for_pickup"
): Promise<void> {
  if (isUberEatsTokenExpired(storeId)) {
    throw new Error("UberEats token expired");
  }

  const token = await getUberEatsToken(storeId);
  const endpoint = UBEREATS_ENDPOINTS.update.replace("{delivery_id}", deliveryId);

  const response = await fetch(`${UBEREATS_API_BASE}${endpoint}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to update delivery status: ${err}`);
  }
}