/**
 * Fire-and-forget helpers para sincronizar datos al Hub Central.
 * Los errores se loguean pero nunca bloquean la respuesta al cliente.
 */

const HUB_URL = process.env.HUB_URL;
const HUB_SYNC_SECRET = process.env.HUB_SYNC_SECRET;
const STORE_ID = process.env.STORE_ID;

function hubHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${HUB_SYNC_SECRET}`,
  };
}

export function syncProductsToHub(
  productos: {
    producto_id: string;
    nombre_producto: string;
    marca?: string;
    categoria?: string;
    codigo_barra?: string | null;
    precio: number;
    stock: number;
    tipo_animal?: string | null;
    peso_gramos?: number | null;
    precio_oferta?: number | null;
    en_oferta?: boolean;
    imagen_url?: string | null;
    activo?: boolean;
  }[]
) {
  if (!HUB_URL || !HUB_SYNC_SECRET) return;

  const elegibles = productos.filter((p) => p.activo === false || p.precio >= 1000);
  if (elegibles.length === 0) return;

  fetch(`${HUB_URL}/functions/v1/sync-catalog`, {
    method: "POST",
    headers: hubHeaders(),
    body: JSON.stringify({ store_id: STORE_ID, productos: elegibles }),
  }).catch((err) => console.error("[hub-sync] catalog:", err));
}

export function syncPurchaseToHub(rut: string, monto: number) {
  if (!HUB_URL || !HUB_SYNC_SECRET) return;

  fetch(`${HUB_URL}/functions/v1/sync-purchase`, {
    method: "POST",
    headers: hubHeaders(),
    body: JSON.stringify({
      store_id: STORE_ID,
      rut,
      monto,
      fecha: new Date().toISOString().split("T")[0],
    }),
  }).catch((err) => console.error("[hub-sync] purchase:", err));
}