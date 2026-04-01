/**
 * Fire-and-forget helpers para sincronizar datos al Hub Central.
 * Los errores se loguean pero nunca bloquean la respuesta al cliente.
 */

const HUB_URL = process.env.HUB_URL;
const HUB_SYNC_SECRET = process.env.HUB_SYNC_SECRET;

function hubHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${HUB_SYNC_SECRET}`,
  };
}

/** Sincroniza uno o más productos al catálogo del hub. */
export function syncProductsToHub(
  productos: {
    producto_id: string;
    nombre_producto: string;
    marca?: string;
    categoria?: string;
    precio: number;
    stock: number;
    imagen_url?: string | null;
    activo?: boolean;
  }[]
) {
  if (!HUB_URL || !HUB_SYNC_SECRET) return;

  fetch(`${HUB_URL}/api/sync/catalog`, {
    method: "POST",
    headers: hubHeaders(),
    body: JSON.stringify({ productos }),
  }).catch((err) => console.error("[hub-sync] catalog:", err));
}

/** Notifica al hub que se realizó una compra (para historial cross-store). */
export function syncPurchaseToHub(rut: string, monto: number) {
  if (!HUB_URL || !HUB_SYNC_SECRET) return;

  fetch(`${HUB_URL}/api/sync/purchase`, {
    method: "POST",
    headers: hubHeaders(),
    body: JSON.stringify({ rut, monto }),
  }).catch((err) => console.error("[hub-sync] purchase:", err));
}
