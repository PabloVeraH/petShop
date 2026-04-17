"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface PagoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (pago: { metodo: string; numeroTransaccion?: string; comprobante?: string }) => void;
  total: number;
  isLoading?: boolean;
}

export function PagoModal({ isOpen, onClose, onConfirm, total, isLoading }: PagoModalProps) {
  const [metodo, setMetodo] = useState<"efectivo" | "debito" | "credito" | "transferencia">("efectivo");
  const [numeroTransaccion, setNumeroTransaccion] = useState("");
  const [comprobante, setComprobante] = useState("");

  const metodoRequiereTransaccion = metodo !== "efectivo";

  const handleConfirm = () => {
    if (metodoRequiereTransaccion && !numeroTransaccion.trim()) {
      alert(`Ingrese número de transacción para ${metodo}`);
      return;
    }
    onConfirm({
      metodo,
      numeroTransaccion: numeroTransaccion || undefined,
      comprobante: comprobante || undefined,
    });
    setMetodo("efectivo");
    setNumeroTransaccion("");
    setComprobante("");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Pago</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Total: ${total.toLocaleString("es-CL")}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Método de pago</label>
            <select
              value={metodo}
              onChange={(e) => setMetodo(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
            >
              <option value="efectivo">💵 Efectivo</option>
              <option value="debito">🏧 Débito</option>
              <option value="credito">💳 Crédito</option>
              <option value="transferencia">🏦 Transferencia</option>
            </select>
          </div>

          {metodoRequiereTransaccion && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Número de transacción *
              </label>
              <input
                type="text"
                value={numeroTransaccion}
                onChange={(e) => setNumeroTransaccion(e.target.value)}
                placeholder={`Ej: TXN123456 (${metodo})`}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Comprobante (opcional)</label>
            <input
              type="text"
              value={comprobante}
              onChange={(e) => setComprobante(e.target.value)}
              placeholder="Referencia adicional"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={isLoading || (metodoRequiereTransaccion && !numeroTransaccion.trim())}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Procesando..." : "Confirmar Pago"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
