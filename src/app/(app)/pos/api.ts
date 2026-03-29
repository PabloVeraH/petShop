import type { Producto, Cliente, Mascota } from "@/types";

export async function getProductos(search: string): Promise<Producto[]> {
  const params = new URLSearchParams({ search });
  const res = await fetch(`/api/productos?${params}`);
  if (!res.ok) throw new Error("Error al cargar productos");
  return res.json();
}

export async function getClienteByRUT(rut: string): Promise<Cliente | null> {
  const params = new URLSearchParams({ rut });
  const res = await fetch(`/api/clientes?${params}`);
  if (!res.ok) throw new Error("Error al buscar cliente");
  return res.json();
}

export async function getMascotasByCliente(clienteId: string): Promise<Mascota[]> {
  const params = new URLSearchParams({ clienteId });
  const res = await fetch(`/api/mascotas?${params}`);
  if (!res.ok) throw new Error("Error al cargar mascotas");
  return res.json();
}

export async function createVenta({
  items,
  clienteId,
  vendedorId,
  metodoPago,
  descuentoPct,
}: {
  items: {
    producto_id: string;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
    mascota_id?: string;
  }[];
  clienteId?: string;
  vendedorId?: string;
  metodoPago: string;
  descuentoPct: number;
}) {
  const res = await fetch("/api/ventas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, clienteId, vendedorId, metodoPago, descuentoPct }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? "Error al crear venta");
  }
  return res.json();
}
