"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { extraerIva } from "@/lib/tax";
import SelectorPagos, { errorFilas, filasAPagos, filasIniciales, type FilaPago } from "@/components/pagos/SelectorPagos";
import type { Cita } from "@/types";

// Modal de cobro de cita. Usa el mismo SelectorPagos que el POS (pago mixto,
// docs/plan_pago_mixto.md F8): antes duplicaba el selector porque el del POS
// estaba atado al store usePOSStore; desde F7 el estado de cobro es local en
// ambos modales. Dispara PATCH /api/citas/[id] con {accion: "completar",
// pagos}; el servidor valida contra el precio de la cita.
interface ModalCobroCitaProps {
  cita: Cita;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ModalCobroCita({ cita, onClose, onSuccess }: ModalCobroCitaProps) {
  const total = Number(cita.precio);
  const iva = extraerIva(total);
  const neto = total - iva;

  const [filas, setFilas] = useState<FilaPago[]>(() => filasIniciales(total));
  const [saldoDisponible, setSaldoDisponible] = useState<number | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [error, setError] = useState("");

  const errorPago = errorFilas(filas, total, cita.cliente_id, saldoDisponible);
  const confirmarDisabled = cobrando || errorPago !== null;

  async function confirmar() {
    setCobrando(true);
    setError("");
    try {
      const res = await fetch(`/api/citas/${cita.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "completar", pagos: filasAPagos(filas) }),
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

          <SelectorPagos
            total={total}
            filas={filas}
            onChange={setFilas}
            clienteId={cita.cliente_id}
            onSaldoDisponible={setSaldoDisponible}
          />
          {errorPago && filas.every((f) => Number.isFinite(f.monto)) && (
            <p className="text-xs text-red-600 -mt-3" data-testid="error-pago">{errorPago}</p>
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
