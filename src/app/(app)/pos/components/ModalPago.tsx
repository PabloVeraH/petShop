"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  usePOSStore,
  calcularSubtotalCarrito,
  calcularSubtotalNetoCarrito,
  calcularTotalCarrito,
} from "@/stores/pos";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { extraerIva } from "@/lib/tax";
import { Skeleton } from "@/components/ui/skeleton";
import SelectorPagos, { errorFilas, filasAPagos, filasIniciales, type FilaPago } from "@/components/pagos/SelectorPagos";
import type { PagoInput } from "@/lib/ventas/pagos";

const PROCEDENCIAS = [
  { value: "presencial", label: "Presencial" },
  { value: "instagram", label: "Instagram" },
  { value: "whatsapp", label: "Whatsapp" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "telefonico", label: "Telefónico" },
];

const DESCUENTOS_RAPIDOS = [5, 10, 15, 20];

type Worker = {
  clerk_id: string;
  nombre: string | null;
  email: string;
  ventas_mes: number;
  ventas_hoy: number;
};

interface ModalPagoProps {
  // Recibe los pagos (1..5 medios) que eligió el cajero; la página los envía
  // a POST /api/ventas, que los valida contra el total del servidor.
  onConfirm: (pagos: PagoInput[]) => void;
  onCancel: () => void;
  isLoading: boolean;
  // Aviso de 135 UF (Ley 21.713); null = la tienda no lo configuró.
  umbralIdentificacion?: number | null;
}

export default function ModalPago({ onConfirm, onCancel, isLoading, umbralIdentificacion = null }: ModalPagoProps) {
  const {
    items, descuento, clienteId,
    setDescuento, fidelizacionDescuento,
    workerClerkId, setWorker,
    procedencia, setProcedencia,
    notas, setNotas,
    clienteEmail, enviarEmailRecibo, setEnviarEmailRecibo,
  } = usePOSStore();

  const { data: workers, isLoading: workersLoading } = useQuery<Worker[]>({
    queryKey: ["workers"],
    queryFn: () => fetch("/api/workers").then((r) => r.json()),
  });

  const sub = calcularSubtotalCarrito(items);
  const subNeto = calcularSubtotalNetoCarrito(items);
  const desc = (sub * descuento) / 100;
  const tot = calcularTotalCarrito(items, descuento);
  const ivaAmount = extraerIva(tot);
  const neto = tot - ivaAmount;

  // Mismo criterio que Carrito.tsx: la etiqueta solo dice "fidelización"
  // mientras el descuento activo siga igual al nivel del cliente — si el
  // vendedor lo edita manualmente (input libre o DESCUENTOS_RAPIDOS más
  // abajo), pasa a mostrarse como descuento genérico.
  const esDescuentoFidelizacion = fidelizacionDescuento > 0 && descuento === fidelizacionDescuento;

  // Estado del cobro: local al modal. Cada apertura arranca neutra (un pago en
  // efectivo por el total); nada sobrevive a un "Cancelar" o a un reload
  // (ticket Trello 6a619fafd0aa9aa5ad06b1dd).
  const [filas, setFilas] = useState<FilaPago[]>(() => filasIniciales(tot));
  const [saldoDisponible, setSaldoDisponible] = useState<number | null>(null);
  const errorPago = errorFilas(filas, tot, clienteId, saldoDisponible);

  const sortedWorkers = workers
    ? [
        workers.find((w) => w.clerk_id === workerClerkId),
        ...workers.filter((w) => w.clerk_id !== workerClerkId),
      ].filter(Boolean) as Worker[]
    : [];

  // Notas internas siguen opcionales, pero si se escribe algo debe alcanzar
  // para trazabilidad real (ticket Trello 6a62eb3057bc5972b4ca8dcc);
  // VentaCreateSchema aplica la misma regla como defensa server-side.
  const notasError = notas.trim().length > 0 && notas.trim().length < 5;

  const confirmarDisabled = isLoading || notasError || errorPago !== null;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm">
        <h2 className="text-base font-semibold mb-4">Confirmar pago</h2>

        <div className="space-y-5">
          {/* Resumen */}
          <div className="rounded bg-gray-50 p-3 text-sm space-y-1">
            {descuento > 0 && (
              <>
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>${subNeto.toLocaleString("es-CL")}</span>
                </div>
                <div className="flex justify-between text-green-600">
                  <span>{esDescuentoFidelizacion ? `Descuento fidelización (${descuento}%)` : `Descuento (${descuento}%)`}</span>
                  <span>−${Math.round(desc).toLocaleString("es-CL")}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-gray-600">
              <span>Neto (sin IVA)</span>
              <span>${neto.toLocaleString("es-CL")}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>IVA (19%)</span>
              <span>${ivaAmount.toLocaleString("es-CL")}</span>
            </div>
            <div className="flex justify-between font-bold text-base border-t pt-2">
              <span>Total</span>
              <span className="text-green-700">${tot.toLocaleString("es-CL")}</span>
            </div>
          </div>

          {/* Medios de pago (pago mixto) */}
          <SelectorPagos
            total={tot}
            filas={filas}
            onChange={setFilas}
            clienteId={clienteId}
            umbralIdentificacion={umbralIdentificacion}
            onSaldoDisponible={setSaldoDisponible}
          />
          {errorPago && filas.every((f) => Number.isFinite(f.monto)) && (
            <p className="text-xs text-red-600 -mt-3" data-testid="error-pago">{errorPago}</p>
          )}

          {/* Worker */}
          {(workersLoading || sortedWorkers.length > 0) && (
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Asignar a vendedor
              </label>
              <div data-testid="worker-field-container">
                {workersLoading ? (
                  <Skeleton className="h-9 w-full" data-testid="worker-skeleton" />
                ) : (
                  <select
                    value={workerClerkId ?? ""}
                    onChange={(e) => setWorker(e.target.value || undefined)}
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="">Sin asignar</option>
                    {sortedWorkers.map((w) => (
                      <option key={w.clerk_id} value={w.clerk_id}>
                        {w.nombre ?? w.email}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          {/* MEJORA (ticket Trello 6a62eb34f2869126d5e8bb30): advierte cuando
              no hay un vendedor específico elegido. El texto evita afirmar que
              la venta "no se atribuye": el backend siempre usa ctx.userId como
              fallback (route.ts: p_worker_clerk_id: workerClerkId ?? ctx.userId),
              así que worker_clerk_id nunca queda NULL en la BD. */}
          {!workerClerkId && (
            <p className="text-xs text-amber-600 font-medium">
              ⚠ No hay un vendedor seleccionado para esta venta
            </p>
          )}

          {/* Procedencia */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              Procedencia
            </label>
            <select
              value={procedencia}
              onChange={(e) => setProcedencia(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {PROCEDENCIAS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Descuento */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Descuento (%)</label>
              {fidelizacionDescuento > 0 && (
                <button
                  type="button"
                  onClick={() => setDescuento(fidelizacionDescuento)}
                  className="text-xs text-green-600 hover:underline"
                >
                  Aplicar fidelización ({fidelizacionDescuento}%)
                </button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2 mb-2">
              {DESCUENTOS_RAPIDOS.map((d) => (
                <Button
                  key={d}
                  type="button"
                  variant={descuento === d ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDescuento(descuento === d ? 0 : d)}
                >
                  {d}%
                </Button>
              ))}
            </div>
            <input
              type="number"
              min="0"
              max="100"
              value={descuento}
              onChange={(e) => setDescuento(Math.min(100, Math.max(0, Number(e.target.value))))}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Notas internas */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              Notas internas
            </label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Observaciones (no visible en el recibo)"
              rows={2}
              maxLength={255}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
            <div className="flex justify-between text-xs mt-1">
              <span className={notasError ? "text-red-500" : "text-transparent"}>
                {notasError ? "Las notas deben tener al menos 5 caracteres" : "-"}
              </span>
              <span className="text-gray-400">{notas.length}/255</span>
            </div>
          </div>

          {/* Email toggle — solo visible si el cliente tiene email */}
          {clienteEmail && (
            <button
              type="button"
              onClick={() => setEnviarEmailRecibo(!enviarEmailRecibo)}
              className={`w-full rounded border px-3 py-2 text-sm transition-colors text-left ${
                enviarEmailRecibo
                  ? "border-blue-400 bg-blue-50 text-blue-700 font-medium"
                  : "border-gray-200 bg-white text-gray-400"
              }`}
            >
              {enviarEmailRecibo ? "✓" : "○"} Enviar comprobante por mail al cliente
            </button>
          )}

          {/* Acciones */}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} className="flex-1" disabled={isLoading}>
              Cancelar
            </Button>
            <Button
              onClick={() => onConfirm(filasAPagos(filas))}
              disabled={confirmarDisabled}
              className="flex-1"
            >
              {isLoading ? "Procesando..." : `Cobrar $${tot.toLocaleString("es-CL")}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
