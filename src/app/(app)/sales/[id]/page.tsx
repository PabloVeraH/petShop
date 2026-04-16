"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DevolucionModal } from "@/components/sales/DevolucionModal";

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
  clientes: { id: string; nombre: string; rut: string; telefono?: string } | null;
  vendedores: { nombre: string } | null;
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
  const queryClient = useQueryClient();
  const [confirmAnular, setConfirmAnular] = useState(false);
  const [showDevolucionModal, setShowDevolucionModal] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["venta", id],
    queryFn: () => getVenta(id),
  });

  const { data: storeData } = useQuery<{ name: string }>({
    queryKey: ["store-name"],
    queryFn: () => fetch("/api/settings").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const storeName = storeData?.name ?? "PetShop";

  const { data: notasCredito } = useQuery({
    queryKey: ["notas-credito", id],
    queryFn: () =>
      fetch(`/api/notas-credito?ventaId=${id}`)
        .then((r) => r.json())
        .catch(() => ({ data: [] })),
  });

  const { data: saldoFavor } = useQuery({
    queryKey: ["saldo", data?.clientes?.id],
    queryFn: () => {
      if (!data?.clientes?.id) return Promise.resolve({ saldo_disponible: 0 });
      return fetch(`/api/saldos-a-favor?clienteId=${data.clientes.id}`).then((r) => r.json());
    },
    enabled: !!data?.clientes?.id,
  });

  const { mutate: anularVenta, isPending: anulando } = useMutation({
    mutationFn: () =>
      fetch(`/api/ventas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "anular" }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["venta", id] });
      setConfirmAnular(false);
    },
  });

  if (isLoading) return <p className="p-8 text-gray-400 text-sm">Cargando...</p>;
  if (isError || !data) return <p className="p-8 text-red-500 text-sm">Venta no encontrada.</p>;

  const cliente = data.clientes as unknown as { id: string; nombre: string; rut: string; telefono?: string } | null;
  const vendedor = data.vendedores as unknown as { nombre: string } | null;
  const fecha = new Date(data.created_at).toLocaleString("es-CL", { dateStyle: "long", timeStyle: "short" });

  const whatsappText = encodeURIComponent(
    `*Comprobante ${storeName}*\n` +
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
    <div className="max-w-md mx-auto space-y-4">
      {/* Acciones (no se imprimen) */}
      <div className="flex gap-2 mb-4 print:hidden flex-wrap">
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
        {data.estado !== "anulada" && (
          <>
            <Button
              variant="outline"
              onClick={() => setShowDevolucionModal(true)}
              className="text-amber-600 border-amber-200 hover:bg-amber-50"
            >
              Devolución parcial
            </Button>
            {confirmAnular ? (
              <div className="flex gap-2 items-center">
                <span className="text-sm text-red-600">¿Confirmar anulación?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => anularVenta()}
                  disabled={anulando}
                >
                  {anulando ? "Anulando..." : "Sí, anular"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmAnular(false)}>
                  No
                </Button>
              </div>
            ) : (
              <Button variant="outline" onClick={() => setConfirmAnular(true)} className="text-red-600 border-red-200 hover:bg-red-50">
                Anular venta
              </Button>
            )}
          </>
        )}
      </div>

      {/* Saldo a favor del cliente */}
      {data?.clientes && saldoFavor?.saldo_disponible > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 print:hidden">
          <p className="text-xs text-blue-600 font-medium">Saldo a favor disponible</p>
          <p className="text-lg font-bold text-blue-700">
            ${Math.round(Number(saldoFavor.saldo_disponible)).toLocaleString("es-CL")}
          </p>
        </div>
      )}

      {/* Ticket */}
      <div className="bg-white rounded-lg shadow-sm p-6 space-y-4 print:shadow-none print:p-0">
        {data.estado === "anulada" && (
          <div className="bg-red-50 border border-red-200 rounded-md px-4 py-2 text-center text-red-700 text-sm font-medium">
            ⚠ Venta anulada — stock revertido
          </div>
        )}

        <div className="text-center border-b pb-4">
          <h1 className="text-lg font-bold">{storeName}</h1>
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
        {vendedor && (
          <p className="text-xs text-gray-400">Atendido por: {vendedor.nombre}</p>
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

      {/* Devoluciones registradas */}
      {notasCredito?.data && notasCredito.data.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm p-4 print:hidden space-y-3">
          <h3 className="font-bold text-sm">Devoluciones registradas</h3>
          <div className="space-y-2">
            {notasCredito.data.map((nc: any) => (
              <div key={nc.id} className="border rounded-lg p-3 bg-gray-50">
                <div className="flex justify-between items-start gap-2 mb-1">
                  <p className="font-mono text-xs text-gray-600">{nc.numero_nc}</p>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    nc.tipo_reembolso === "saldo_a_favor"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-green-100 text-green-700"
                  }`}>
                    {nc.tipo_reembolso === "saldo_a_favor" ? "Saldo a favor" : "Reembolso directo"}
                  </span>
                </div>
                <p className="text-sm font-medium text-gray-700">
                  ${Math.round(Number(nc.monto_total)).toLocaleString("es-CL")}
                </p>
                {nc.motivo && (
                  <p className="text-xs text-gray-500 mt-1">{nc.motivo}</p>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(nc.created_at).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal de devolución */}
      <DevolucionModal
        isOpen={showDevolucionModal}
        ventaId={id}
        ventaTotal={data?.total ?? 0}
        items={data?.items ?? []}
        clienteId={data?.clientes?.id ?? null}
        onClose={() => setShowDevolucionModal(false)}
        onSuccess={() => setShowDevolucionModal(false)}
      />
    </div>
  );
}
