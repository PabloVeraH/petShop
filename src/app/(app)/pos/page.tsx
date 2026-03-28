"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/stores/pos";
import { createVenta } from "./api";
import SearchProductos from "./components/SearchProductos";
import Carrito from "./components/Carrito";
import ModalCliente from "./components/ModalCliente";
import ModalPago from "./components/ModalPago";
import { Button } from "@/components/ui/button";

export default function POSPage() {
  const [showClienteModal, setShowClienteModal] = useState(false);
  const [showPagoModal, setShowPagoModal] = useState(false);
  const [ventaExito, setVentaExito] = useState(false);

  const queryClient = useQueryClient();
  const { items, clienteId, mascotaId, metodoPago, descuento, total, clearCart } = usePOSStore();

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
        metodoPago: metodoPago!,
        descuentoPct: descuento,
      }),
    onSuccess: () => {
      clearCart();
      setShowPagoModal(false);
      setVentaExito(true);
      queryClient.invalidateQueries({ queryKey: ["productos"] });
      setTimeout(() => setVentaExito(false), 3000);
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
      </div>

      <div className="grid grid-cols-3 gap-4 flex-1">
        {/* Búsqueda (izquierda) */}
        <div className="col-span-2">
          <SearchProductos />
        </div>

        {/* Carrito + acciones (derecha) */}
        <div className="flex flex-col gap-3">
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

          <Button
            onClick={() => setShowPagoModal(true)}
            disabled={items.length === 0}
            className="w-full"
            size="lg"
          >
            Cobrar ${Math.round(total()).toLocaleString("es-CL")}
          </Button>
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
