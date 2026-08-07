"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { extraerIva } from "@/lib/tax";
import type { Cita } from "@/types";

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

// Modal de cobro de cita (Fase 4). Decisión §8c del plan: el selector de pago
// + validación de NC de ModalPago.tsx (POS) se DUPLICA acá en vez de extraerse
// a un componente compartido, porque el original está atado al store Zustand
// usePOSStore (metodoPago/pagoNc/numeroTransaccion) y tocarlo arriesga la
// regresión histórica del modal de pago (ticket Trello 6a619fafd0aa9aa5ad06b1dd).
// Este modal usa estado local y dispara el PATCH completar de la cita con el
// body {accion, metodoPago, numeroTransaccion?, pagoNc?}.
interface ModalCobroCitaProps {
  cita: Cita;
  onClose: () => void;
  onSuccess: () => void;
}

interface NcValidada {
  id: string;
  numero_nc: string;
  monto_total: number;
  fecha_vencimiento: string;
}

export default function ModalCobroCita({ cita, onClose, onSuccess }: ModalCobroCitaProps) {
  const total = Number(cita.precio);
  const iva = extraerIva(total);
  const neto = total - iva;

  const [metodoPago, setMetodoPago] = useState("efectivo");
  const [numeroTransaccion, setNumeroTransaccion] = useState("");
  const [trxError, setTrxError] = useState(false);
  const [ncCodigo, setNcCodigo] = useState("");
  const [ncValidando, setNcValidando] = useState(false);
  const [ncValidado, setNcValidado] = useState<NcValidada | null>(null);
  const [ncError, setNcError] = useState<string | null>(null);
  const [pagoNc, setPagoNc] = useState<{ nota_credito_id: string; numero_nc: string; monto: number } | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [error, setError] = useState("");

  const modoNc = metodoPago === "nota_credito" || (!!pagoNc && metodoPago !== "nota_credito");
  const montoNc = pagoNc?.monto ?? 0;
  const montoResto = Math.round(total - montoNc);

  async function validarNc() {
    if (!ncCodigo.trim()) return;
    setNcValidando(true);
    setNcError(null);
    setNcValidado(null);
    setPagoNc(null);
    try {
      const res = await fetch(`/api/notas-credito?numero_nc=${encodeURIComponent(ncCodigo.trim())}`);
      const json = await res.json();
      if (!res.ok) {
        setNcError(json.error ?? "Error validando NC");
        return;
      }
      const nc = json.data;
      setNcValidado(nc);
      const montoAplicar = Math.min(Number(nc.monto_total), total);
      setPagoNc({ nota_credito_id: nc.id, numero_nc: nc.numero_nc, monto: montoAplicar });
      if (montoAplicar >= total) {
        setMetodoPago("nota_credito");
      }
    } finally {
      setNcValidando(false);
    }
  }

  function selectMethod(value: string) {
    setTrxError(false);
    if (value === "nota_credito") {
      setMetodoPago("nota_credito");
      setNumeroTransaccion("");
      setNcCodigo("");
      setNcValidado(null);
      setNcError(null);
      setPagoNc(null);
    } else {
      if (!pagoNc) {
        setNcCodigo("");
        setNcValidado(null);
        setNcError(null);
        setPagoNc(null);
      }
      setMetodoPago(value);
      if (value === "efectivo") setNumeroTransaccion("");
    }
  }

  const confirmarDisabled =
    cobrando ||
    !metodoPago ||
    (modoNc && !pagoNc) ||
    (!!pagoNc && montoResto > 0 && metodoPago === "nota_credito") ||
    (!pagoNc && ["debito", "credito", "transferencia"].includes(metodoPago) && !numeroTransaccion.trim()) ||
    (!!pagoNc && montoResto > 0 && ["debito", "credito", "transferencia"].includes(metodoPago) && !numeroTransaccion.trim());

  async function confirmar() {
    setCobrando(true);
    setError("");
    try {
      const res = await fetch(`/api/citas/${cita.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "completar",
          metodoPago,
          numeroTransaccion: numeroTransaccion.trim() || undefined,
          pagoNc: pagoNc ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error al cobrar la cita");
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
      setCobrando(false);
    }
  }

  return (
    <ModalOverlay open onClose={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm mx-4">
        <h2 className="text-base font-semibold mb-4">Cobrar cita</h2>

        <div className="space-y-5">
          {/* Resumen */}
          <div className="rounded bg-gray-50 p-3 text-sm space-y-1">
            <div className="flex justify-between text-gray-600">
              <span>Servicio</span>
              <span className="text-right">{cita.servicio?.nombre ?? "—"}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Neto (sin IVA)</span>
              <span>${neto.toLocaleString("es-CL")}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>IVA (19%)</span>
              <span>${iva.toLocaleString("es-CL")}</span>
            </div>
            <div className="flex justify-between font-bold text-base border-t pt-2">
              <span>Total</span>
              <span className="text-green-700">${total.toLocaleString("es-CL")}</span>
            </div>
          </div>

          {/* Método de pago */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">Método de pago</label>
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
                          if (m.value === "efectivo") setNumeroTransaccion("");
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
          {["debito", "credito", "transferencia"].includes(metodoPago) && (
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                {pagoNc && montoResto > 0 ? "N° transacción (diferencia)" : "Número de transacción"} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Ej: TRX123456789"
                required
                value={numeroTransaccion}
                onChange={(e) => setNumeroTransaccion(e.target.value)}
                onBlur={() => {
                  if (!numeroTransaccion.trim()) setTrxError(true);
                }}
                onFocus={() => setTrxError(false)}
                className={`w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ${trxError ? "border-red-400 focus:ring-red-400" : "border-gray-300 focus:ring-green-500"}`}
              />
              {trxError && (
                <p className="text-xs text-red-500 mt-1">Campo obligatorio para pagos con débito/crédito/transferencia</p>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1" disabled={cobrando}>
              Cancelar
            </Button>
            <Button onClick={confirmar} disabled={confirmarDisabled} className="flex-1">
              {cobrando ? "Cobrando..." : `Cobrar $${total.toLocaleString("es-CL")}`}
            </Button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
