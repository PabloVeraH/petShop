"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePOSStore } from "@/stores/pos";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const METODOS_PAGO = [
  { value: "efectivo", label: "Efectivo" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
  { value: "transferencia", label: "Transf." },
  { value: "nota_credito", label: "NC" },
];

const METODOS_RESTO = [
  { value: "efectivo", label: "Efectivo" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
  { value: "transferencia", label: "Transf." },
];

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
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

export default function ModalPago({ onConfirm, onCancel, isLoading }: ModalPagoProps) {
  const {
    subtotal, descuento, total, metodoPago, setMetodoPago,
    numeroTransaccion, setNumeroTransaccion,
    setDescuento, fidelizacionDescuento,
    workerClerkId, setWorker,
    procedencia, setProcedencia,
    pagoNc, setPayNc, clearPayNc,
  } = usePOSStore();

  const { data: workers } = useQuery<Worker[]>({
    queryKey: ["workers"],
    queryFn: () => fetch("/api/workers").then((r) => r.json()),
  });

  const sub = subtotal();
  const desc = (sub * descuento) / 100;
  const tot = Math.round(total());

  // NC local state
  const [ncCodigo, setNcCodigo] = useState("");
  const [ncValidando, setNcValidando] = useState(false);
  const [ncValidado, setNcValidado] = useState<{
    id: string; numero_nc: string; monto_total: number; fecha_vencimiento: string;
  } | null>(null);
  const [ncError, setNcError] = useState<string | null>(null);
  const modoNc = metodoPago === "nota_credito" || (!!pagoNc && metodoPago !== "nota_credito");

  const montoNc = pagoNc?.monto ?? 0;
  const montoResto = Math.round((tot - montoNc) * 100) / 100;

  const sortedWorkers = workers
    ? [
        workers.find((w) => w.clerk_id === workerClerkId),
        ...workers.filter((w) => w.clerk_id !== workerClerkId),
      ].filter(Boolean) as Worker[]
    : [];

  async function validarNc() {
    if (!ncCodigo.trim()) return;
    setNcValidando(true);
    setNcError(null);
    setNcValidado(null);
    clearPayNc();
    try {
      const res = await fetch(`/api/notas-credito?numero_nc=${encodeURIComponent(ncCodigo.trim())}`);
      const json = await res.json();
      if (!res.ok) {
        setNcError(json.error ?? "Error validando NC");
        return;
      }
      const nc = json.data;
      setNcValidado(nc);
      const montoAplicar = Math.min(Number(nc.monto_total), tot);
      setPayNc({ nota_credito_id: nc.id, numero_nc: nc.numero_nc, monto: montoAplicar });
      if (montoAplicar >= tot) {
        setMetodoPago("nota_credito");
      }
      // If partial, metodoPago remains "nota_credito" until user picks rest method
    } finally {
      setNcValidando(false);
    }
  }

  function selectMethod(value: string) {
    if (value === "nota_credito") {
      setMetodoPago("nota_credito");
      setNumeroTransaccion(undefined);
      setNcCodigo("");
      setNcValidado(null);
      setNcError(null);
      clearPayNc();
    } else {
      if (pagoNc) {
        // switching rest method in mixed payment
        setMetodoPago(value);
        if (value === "efectivo") setNumeroTransaccion(undefined);
      } else {
        setMetodoPago(value);
        if (value === "efectivo") setNumeroTransaccion(undefined);
        setNcCodigo("");
        setNcValidado(null);
        setNcError(null);
        clearPayNc();
      }
    }
  }

  const confirmarDisabled =
    isLoading ||
    !metodoPago ||
    (!pagoNc && ["debito", "credito", "transferencia"].includes(metodoPago ?? "") && !numeroTransaccion) ||
    (pagoNc && montoResto > 0 && ["debito", "credito", "transferencia"].includes(metodoPago ?? "") && !numeroTransaccion) ||
    (modoNc && !pagoNc) ||
    (!!pagoNc && montoResto > 0 && metodoPago === "nota_credito");

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm">
        <h2 className="text-base font-semibold mb-4">Confirmar pago</h2>

        <div className="space-y-5">
          {/* Resumen */}
          <div className="rounded bg-gray-50 p-3 text-sm space-y-1">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>${sub.toLocaleString("es-CL")}</span>
            </div>
            {descuento > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Descuento ({descuento}%)</span>
                <span>−${Math.round(desc).toLocaleString("es-CL")}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>IVA (19%)</span>
              <span>${Math.round((sub - desc) * 0.19).toLocaleString("es-CL")}</span>
            </div>
            <div className="flex justify-between font-bold text-base border-t pt-2">
              <span>Total</span>
              <span className="text-green-700">${tot.toLocaleString("es-CL")}</span>
            </div>
          </div>

          {/* Método de pago */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">
              Método de pago
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {METODOS_PAGO.map((m) => (
                <Button
                  key={m.value}
                  variant={
                    (m.value === "nota_credito" && (modoNc || metodoPago === "nota_credito"))
                      ? "default"
                      : (m.value !== "nota_credito" && !pagoNc && metodoPago === m.value)
                        ? "default"
                        : "outline"
                  }
                  onClick={() => selectMethod(m.value)}
                  size="sm"
                  className="text-xs px-1"
                >
                  {m.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Sección NC */}
          {(metodoPago === "nota_credito" || (pagoNc && montoResto > 0)) && (
            <div className="border rounded-lg p-3 space-y-3 bg-amber-50">
              <p className="text-xs font-medium text-amber-800">Nota de Crédito</p>

              {!pagoNc && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Código NC (ej: NC-20260508-ABCD1234)"
                    value={ncCodigo}
                    onChange={(e) => { setNcCodigo(e.target.value); setNcError(null); }}
                    onKeyDown={(e) => e.key === "Enter" && validarNc()}
                    className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={validarNc}
                    disabled={ncValidando || !ncCodigo.trim()}
                    className="text-xs border-amber-300"
                  >
                    {ncValidando ? "..." : "Validar"}
                  </Button>
                </div>
              )}

              {ncError && <p className="text-xs text-red-600">{ncError}</p>}

              {ncValidado && pagoNc && (
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-600">NC:</span>
                    <span className="font-mono font-medium">{ncValidado.numero_nc}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Monto NC:</span>
                    <span className="font-medium text-amber-700">${pagoNc.monto.toLocaleString("es-CL")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Vence:</span>
                    <span>{new Date(ncValidado.fecha_vencimiento + "T12:00:00").toLocaleDateString("es-CL")}</span>
                  </div>
                  {montoResto > 0 && (
                    <div className="flex justify-between font-medium text-red-700 border-t pt-1">
                      <span>Diferencia a pagar:</span>
                      <span>${montoResto.toLocaleString("es-CL")}</span>
                    </div>
                  )}
                </div>
              )}

              {pagoNc && montoResto > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-700 mb-1.5">Pagar diferencia con:</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {METODOS_RESTO.map((m) => (
                      <Button
                        key={m.value}
                        variant={metodoPago === m.value ? "default" : "outline"}
                        onClick={() => {
                          setMetodoPago(m.value);
                          if (m.value === "efectivo") setNumeroTransaccion(undefined);
                        }}
                        size="sm"
                        className="text-xs px-1"
                      >
                        {m.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Número de transacción — para débito/crédito/transferencia */}
          {["debito", "credito", "transferencia"].includes(metodoPago ?? "") && (
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                {pagoNc && montoResto > 0 ? "N° transacción (diferencia)" : "Número de transacción"}
              </label>
              <input
                type="text"
                placeholder="Ej: TRX123456789"
                value={numeroTransaccion ?? ""}
                onChange={(e) => setNumeroTransaccion(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          )}

          {/* Worker */}
          {sortedWorkers.length > 0 && (
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Asignar a vendedor
              </label>
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
            </div>
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

          {/* Acciones */}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} className="flex-1" disabled={isLoading}>
              Cancelar
            </Button>
            <Button
              onClick={onConfirm}
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
