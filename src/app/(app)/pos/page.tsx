"use client";

import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { usePOSStore, calcularTotalCarrito } from "@/stores/pos";
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
  const exitoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // UUID estable para todo el intento de cobro actual (mismo modal abierto).
  // Se genera al abrir el modal y se reenvía sin cambios en cada reintento de
  // "Cobrar" dentro de esa misma apertura — permite al backend detectar un
  // reintento tras un error de red ("Failed to fetch" con la venta ya creada
  // en el servidor) y devolver la venta existente en vez de duplicarla
  // (ticket Trello 6a61a067a9350a401550e770). Reabrir el modal genera una
  // key nueva, tratando esa reapertura como un intento de cobro distinto.
  const idempotencyKeyRef = useRef<string | null>(null);

  const { userId, sessionClaims } = useAuth();
  const meta = sessionClaims?.publicMetadata as Record<string, boolean> | undefined;
  const isStoreAdmin = meta?.storeAdmin === true;

  const queryClient = useQueryClient();
  const { items, clienteId, mascotaId, workerClerkId, metodoPago, numeroTransaccion, descuento, procedencia, pagoNc, notas, enviarEmailRecibo, clearCart, setWorker } = usePOSStore();
  // Total calculado con calcularTotalCarrito(items, descuento) — la MISMA
  // función pura que Carrito.tsx y ModalPago.tsx, aplicada a los MISMOS
  // items/descuento ya destructurados arriba en este render. Evita
  // depender de state.total() (un getter del store que lee get() en el
  // momento de la invocación): tras la rehidratación de Zustand persist
  // desde localStorage, ese getter podía devolver un total inconsistente
  // con los items ya visibles, mostrando "Cobrar $0" hasta que el usuario
  // mutara el carrito (addItem/removeItem) y forzara un recálculo correcto.
  const cartTotal = calcularTotalCarrito(items, descuento);

  // Rastrear para qué userId se inicializó workerClerkId — si el usuario autenticado
  // cambia (sesión compartida, turno de vendedores), resetear al usuario actual aunque
  // workerClerkId ya tenga valor de la sesión anterior persisted en localStorage.
  const initializedWorkerForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    if (initializedWorkerForRef.current === userId) return;
    initializedWorkerForRef.current = userId;
    setWorker(userId);
  }, [userId, setWorker]);

  useEffect(() => {
    return () => {
      if (exitoTimerRef.current) clearTimeout(exitoTimerRef.current);
    };
  }, []);

  const { mutate: procesarVenta, isPending } = useMutation({
    mutationFn: () =>
      createVenta({
        items: items.map((i) => ({
          producto_id: i.producto_id,
          cantidad: i.cantidad,
          precio_unitario: i.precio,
          subtotal: i.subtotal,
          mascota_id: i.mascota_id,
          es_granel: i.es_granel,
          gramos: i.gramos,
        })),
        clienteId,
        workerClerkId,
        metodoPago: metodoPago!,
        numeroTransaccion,
        descuentoPct: descuento,
        procedencia,
        pagoNc,
        notas,
        enviarEmail: enviarEmailRecibo,
        idempotencyKey: idempotencyKeyRef.current ?? undefined,
      }),
    onSuccess: (data) => {
      idempotencyKeyRef.current = null;
      clearCart();
      setShowPagoModal(false);
      setVentaError(null);
      setVentaExito(true);
      queryClient.invalidateQueries({ queryKey: ["productos"], refetchType: "all" });
      queryClient.invalidateQueries({ queryKey: ["ventas"], refetchType: "all" });
      queryClient.invalidateQueries({ queryKey: ["inventario"], refetchType: "all" });
      queryClient.invalidateQueries({ queryKey: ["lotes"], refetchType: "all" });
      exitoTimerRef.current = setTimeout(() => setVentaExito(false), 3000);
      if (data?.id) {
        const popup = window.open(`/sales/${data.id}?autoPrint=1`, "_blank", "width=620,height=820");
        if (!popup) console.warn("Pop-up bloqueado — abre manualmente la venta");
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
            onClick={() => {
              idempotencyKeyRef.current = crypto.randomUUID();
              setShowPagoModal(true);
            }}
            disabled={items.length === 0}
            className="w-full"
            size="lg"
          >
            {items.length === 0 ? "Carrito vacío" : `Cobrar $${cartTotal.toLocaleString("es-CL")}`}
          </Button>
        </div>

        {/* Búsqueda — abajo en mobile, izquierda (2 cols) en desktop */}
        <div className="lg:col-span-2 h-full">
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