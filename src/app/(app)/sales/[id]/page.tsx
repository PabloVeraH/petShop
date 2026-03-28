"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

type VentaDetalle = {
  id: string;
  numero_comprobante: string | null;
  subtotal: number;
  descuento: number;
  impuesto: number;
  total: number;
  metodo_pago: string | null;
  estado: string;
  created_at: string;
  clientes: { nombre: string; rut: string; telefono?: string } | null;
  items: Array<{
    id: string;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
    productos: { nombre: string; sku: string } | null;
  }>;
};

async function getVenta(id: string): Promise<VentaDetalle> {
  const res = await fetch(`/api/ventas/${id}`);
  if (!res.ok) throw new Error("Venta no encontrada");
  return res.json();
}

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["venta", id],
    queryFn: () => getVenta(id),
  });

  if (isLoading) return <p className="p-8 text-gray-400 text-sm">Cargando...</p>;
  if (isError || !data) return <p className="p-8 text-red-500 text-sm">Venta no encontrada.</p>;

  const cliente = data.clientes as unknown as { nombre: string; rut: string; telefono?: string } | null;
  const fecha = new Date(data.created_at).toLocaleString("es-CL", { dateStyle: "long", timeStyle: "short" });

  const whatsappText = encodeURIComponent(
    `*Comprobante PetShop*\n` +
    `N°: ${data.numero_comprobante ?? data.id.slice(0, 8)}\n` +
    `Fecha: ${fecha}\n` +
    (cliente ? `Cliente: ${cliente.nombre}\n` : "") +
    `\n*Productos:*\n` +
    (data.items.map((i) => {
      const prod = i.productos as unknown as { nombre: string } | null;
      return `• ${prod?.nombre ?? "Producto"} x${i.cantidad} = $${Math.round(i.subtotal).toLocaleString("es-CL")}`;
    }).join("\n")) +
    `\n\nSubtotal: $${Math.round(Number(data.subtotal)).toLocaleString("es-CL")}` +
    (Number(data.descuento) > 0 ? `\nDescuento: -$${Math.round(Number(data.descuento)).toLocaleString("es-CL")}` : "") +
    `\nIVA: $${Math.round(Number(data.impuesto)).toLocaleString("es-CL")}` +
    `\n*TOTAL: $${Math.round(Number(data.total)).toLocaleString("es-CL")}*` +
    `\nMétodo: ${data.metodo_pago ?? "efectivo"}`
  );

  const whatsappUrl = cliente?.telefono
    ? `https://wa.me/56${cliente.telefono.replace(/\D/g, "")}?text=${whatsappText}`
    : `https://wa.me/?text=${whatsappText}`;

  return (
    <div className="max-w-md mx-auto">
      {/* Acciones (no se imprimen) */}
      <div className="flex gap-2 mb-4 print:hidden">
        <Button variant="outline" onClick={() => window.history.back()}>
          ← Volver
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          Imprimir
        </Button>
        <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
          <Button className="bg-green-500 hover:bg-green-600">
            WhatsApp
          </Button>
        </a>
      </div>

      {/* Ticket */}
      <div className="bg-white rounded-lg shadow-sm p-6 space-y-4 print:shadow-none print:p-0">
        <div className="text-center border-b pb-4">
          <h1 className="text-lg font-bold">PetShop</h1>
          <p className="text-xs text-gray-500">Comprobante de venta</p>
          <p className="text-sm font-medium mt-1">
            N° {data.numero_comprobante ?? data.id.slice(0, 8).toUpperCase()}
          </p>
          <p className="text-xs text-gray-400">{fecha}</p>
        </div>

        {cliente && (
          <div className="text-sm">
            <p className="font-medium">{cliente.nombre}</p>
            <p className="text-gray-500 text-xs">RUT: {cliente.rut}</p>
          </div>
        )}

        <div className="space-y-1">
          {data.items.map((item) => {
            const prod = item.productos as unknown as { nombre: string; sku: string } | null;
            return (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="flex-1 mr-2">
                  {prod?.nombre ?? "Producto"}
                  <span className="text-gray-400 text-xs ml-1">×{item.cantidad}</span>
                </span>
                <span>${Math.round(item.subtotal).toLocaleString("es-CL")}</span>
              </div>
            );
          })}
        </div>

        <div className="border-t pt-3 space-y-1 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Subtotal</span>
            <span>${Math.round(Number(data.subtotal)).toLocaleString("es-CL")}</span>
          </div>
          {Number(data.descuento) > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Descuento</span>
              <span>−${Math.round(Number(data.descuento)).toLocaleString("es-CL")}</span>
            </div>
          )}
          <div className="flex justify-between text-gray-600">
            <span>IVA (19%)</span>
            <span>${Math.round(Number(data.impuesto)).toLocaleString("es-CL")}</span>
          </div>
          <div className="flex justify-between font-bold text-base border-t pt-2">
            <span>TOTAL</span>
            <span className="text-green-700">${Math.round(Number(data.total)).toLocaleString("es-CL")}</span>
          </div>
          <div className="flex justify-between text-gray-500 text-xs pt-1">
            <span>Método de pago</span>
            <span className="capitalize">{data.metodo_pago ?? "efectivo"}</span>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 border-t pt-3">
          ¡Gracias por su compra!
        </p>
      </div>
    </div>
  );
}
