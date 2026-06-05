"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { usePOSStore } from "@/stores/pos";
import { createVenta } from "./api";
import SearchProductos from "./components/SearchProductos";
import Carrito from "./components/Carrito";
import ModalCliente from "./components/ModalCliente";
import ModalPago from "./components/ModalPago";
import RecomendacionesIA from "./components/RecomendacionesIA";
import { Button } from "@/components/ui/button";

export default function POSPage() {
  const [showClienteModal, setShowClienteModal] = useState(false);
  const [showPagoModal, setShowPagoModal] = useState(false);
  const [ventaExito, setVentaExito] = useState(false);
  const [ventaError, setVentaError] = useState<string | null>(null);

  const { userId, sessionClaims } = useAuth();
  const meta = sessionClaims?.publicMetadata as Record<string, boolean> | undefined;
  const isStoreAdmin = meta?.storeAdmin === true;

  const queryClient = useQueryClient();
  const { items, clienteId, mascotaId, workerClerkId, metodoPago, numeroTransaccion, descuento, total, procedencia, pagoNc, enviarEmailRecibo, clearCart, setWorker } = usePOSStore();

  useEffect(() => {
    if (userId && !isStoreAdmin) {
      setWorker(userId);
    }
  }, [userId, isStoreAdmin, setWorker]);

  const { mutate: procesarVenta, isPending } = useMutation({
    mutationFn: () =>
      createVenta({
        items: items.map((i) => ({
          producto_id: i.producto_id,
          cantidad: i.cantidad,
          precio_unitario: i.precio,
          subtotal: i.subtotal,
          mascota_id: i.mascota_id,
        })),
        clienteId,
        workerClerkId,
        metodoPago: metodoPago!,
        numeroTransaccion,
        descuentoPct: descuento,
        procedencia,
        pagoNc,
        enviarEmail: enviarEmailRecibo,
      }),
    onSuccess: (data) => {
      clearCart();
      setShowPagoModal(false);
      setVentaError(null);
      setVentaExito(true);
      queryClient.invalidateQueries({ queryKey: ["productos"] });
      setTimeout(() => setVentaExito(false), 3000);
      if (data?.id) {
        window.open(`/sales/${data.id}?autoPrint=1`, "_blank", "width=620,height=820");
      }
    },
    onError: (e: Error) => {
      setVentaError(e.message);
    },
  });

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Punto de Venta</h1>
        {ventaExito && (
          <span className="text-sm font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full">
            ✓ Venta registrada
          </span>
        )}
        {ventaError && (
          <span className="text-sm font-medium text-red-600 bg-red-50 px-3 py-1 rounded-full">
            Error: {ventaError}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1">
        {/* Carrito + acciones — arriba en mobile, derecha en desktop */}
        <div className="flex flex-col gap-3 lg:order-last lg:col-span-1">
          <Carrito />

          <Button
            variant="outline"
            onClick={() => setShowClienteModal(true)}
            className="w-full"
          >
            {clienteId ? "✓ Cliente seleccionado" : "+ Agregar cliente"}
          </Button>

           {clienteId && mascotaId && (
             <p className="text-xs text-center text-green-600">Mascota vinculada ✓</p>
           )}

           <RecomendacionesIA />

           <Button
            onClick={() => setShowPagoModal(true)}
            disabled={items.length === 0}
            className="w-full"
            size="lg"
            suppressHydrationWarning
          >
            Cobrar ${Math.round(total()).toLocaleString("es-CL")}
          </Button>
        </div>

        {/* Búsqueda — abajo en mobile, izquierda (2 cols) en desktop */}
        <div className="lg:col-span-2">
          <SearchProductos />
        </div>
      </div>

      {showClienteModal && (
        <ModalCliente onClose={() => setShowClienteModal(false)} />
      )}

      {showPagoModal && (
        <ModalPago
          onConfirm={() => procesarVenta()}
          onCancel={() => setShowPagoModal(false)}
          isLoading={isPending}
        />
      )}
    </div>
  );
}