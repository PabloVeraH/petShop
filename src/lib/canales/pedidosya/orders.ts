import { PEDIDOSYA_API_BASE, PEDIDOSYA_ENDPOINTS } from "./types";
import { getPedidosYaToken, isPedidosYaTokenExpired } from "./auth";

export async function confirmPedidosYaOrder(
  storeId: string,
  orderId: string
): Promise<void> {
  if (isPedidosYaTokenExpired(storeId)) {
    throw new Error("PedidosYa token expired");
  }

  const token = await getPedidosYaToken(storeId);
  const endpoint = PEDIDOSYA_ENDPOINTS.confirm.replace("{order_id}", orderId);

  const response = await fetch(`${PEDIDOSYA_API_BASE}${endpoint}`, {
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

export async function rejectPedidosYaOrder(
  storeId: string,
  orderId: string,
  reason: string = "Store unavailable"
): Promise<void> {
  if (isPedidosYaTokenExpired(storeId)) {
    throw new Error("PedidosYa token expired");
  }

  const token = await getPedidosYaToken(storeId);
  const endpoint = PEDIDOSYA_ENDPOINTS.reject.replace("{order_id}", orderId);

  const response = await fetch(`${PEDIDOSYA_API_BASE}${endpoint}`, {
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

export async function updatePedidosYaOrderStatus(
  storeId: string,
  orderId: string,
  status: "confirmed" | "preparing" | "ready"
): Promise<void> {
  if (isPedidosYaTokenExpired(storeId)) {
    throw new Error("PedidosYa token expired");
  }

  const token = await getPedidosYaToken(storeId);
  const endpoint = PEDIDOSYA_ENDPOINTS.status.replace("{order_id}", orderId);

  const response = await fetch(`${PEDIDOSYA_API_BASE}${endpoint}`, {
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