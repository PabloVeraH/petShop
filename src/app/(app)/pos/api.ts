import type { Producto, Cliente, Mascota, SacoAccionResultado } from "@/types";
import { errorDeRespuesta, fetchJson } from "@/lib/api-client";

// Todas las llamadas del POS distinguen 429/5xx de "sin datos": un error
// lanza ApiError con un mensaje para el cajero ("Demasiadas solicitudes.
// Reintenta en N s."), nunca se toma como resultado vacío (QA 2026-09-27).

// Granel (§4.6): abrir saco (D18), merma del resto (G6) o deshacer apertura
// (G2, solo admin — lo valida el servidor).
export type AccionSaco =
  | { accion: "abrir"; nota?: string }
  | { accion: "merma"; motivo: string }
  | { accion: "deshacer" };

export async function accionSaco(productoId: string, body: AccionSaco): Promise<SacoAccionResultado> {
  return fetchJson<SacoAccionResultado>(`/api/productos/${productoId}/saco`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getProductos(search: string): Promise<Producto[]> {
  const params = new URLSearchParams({ search });
  return fetchJson<Producto[]>(`/api/productos?${params}`);
}

export async function getClienteByRUT(rut: string): Promise<Cliente | null> {
  const params = new URLSearchParams({ rut });
  return fetchJson<Cliente | null>(`/api/clientes?${params}`);
}

export async function getMascotasByCliente(clienteId: string): Promise<Mascota[]> {
  const params = new URLSearchParams({ clienteId });
  return fetchJson<Mascota[]>(`/api/mascotas?${params}`);
}

export async function createVenta({
  items,
  clienteId,
  workerClerkId,
  metodoPago,
  numeroTransaccion,
  descuentoPct,
  procedencia,
  pagoNc,
  notas,
  enviarEmail,
  idempotencyKey,
}: {
  items: {
    producto_id: string;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
    mascota_id?: string;
    es_granel?: boolean;
    gramos?: number;
    abrir_saco?: boolean;   // granel: el cajero confirmó abrir un saco nuevo (G1)
  }[];
  clienteId?: string;
  workerClerkId?: string;
  metodoPago: string;
  numeroTransaccion?: string;
  descuentoPct: number;
  procedencia: string;
  pagoNc?: { nota_credito_id: string; numero_nc: string; monto: number };
  notas?: string;
  enviarEmail?: boolean;
  // UUID estable por intento de cobro — se reenvía igual en cada reintento
  // (ver pos/page.tsx) para que el backend pueda detectar un reintento tras
  // "Failed to fetch" y devolver la venta ya creada en vez de duplicarla
  // (ticket Trello 6a61a067a9350a401550e770).
  idempotencyKey?: string;
}) {
  const res = await fetch("/api/ventas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, clienteId, workerClerkId, metodoPago, numeroTransaccion, descuentoPct, procedencia, pagoNc, notas, enviarEmail, idempotencyKey }),
  });
  // 429: la venta NO se registró; mensaje con Retry-After. La idempotencyKey
  // se conserva en pos/page.tsx, así que reintentar el cobro es seguro.
  if (res.status === 429) throw errorDeRespuesta(res, await res.json().catch(() => null));
  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const data = await res.json();
      throw new Error(data.error ?? `Error ${res.status}`);
    }
    throw new Error(`Error ${res.status}: respuesta inesperada del servidor. Intente de nuevo.`);
  }
  return res.json();
}