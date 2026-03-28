"use client";

import { usePOSStore } from "@/stores/pos";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const METODOS_PAGO = [
  { value: "efectivo", label: "Efectivo" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
  { value: "transferencia", label: "Transf." },
];

interface ModalPagoProps {
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

export default function ModalPago({ onConfirm, onCancel, isLoading }: ModalPagoProps) {
  const { subtotal, descuento, total, metodoPago, setMetodoPago, setDescuento } =
    usePOSStore();

  const sub = subtotal();
  const desc = (sub * descuento) / 100;
  const tot = Math.round(total());

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
            <div className="grid grid-cols-2 gap-2">
              {METODOS_PAGO.map((m) => (
                <Button
                  key={m.value}
                  variant={metodoPago === m.value ? "default" : "outline"}
                  onClick={() => setMetodoPago(m.value)}
                  size="sm"
                >
                  {m.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Descuento manual */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              Descuento manual (%)
            </label>
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
              disabled={!metodoPago || isLoading}
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
