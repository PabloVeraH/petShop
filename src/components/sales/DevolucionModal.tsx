"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DevolucionItem {
  id: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  productos: { nombre: string } | null;
}

interface DevolucionModalProps {
  isOpen: boolean;
  ventaId: string;
  ventaTotal: number;
  descuento?: number;
  items: DevolucionItem[];
  clienteId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function DevolucionModal({
  isOpen,
  ventaId,
  items,
  descuento = 0,
  clienteId,
  onClose,
  onSuccess,
}: DevolucionModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedItems, setSelectedItems] = useState<Record<string, { cantidad: number; restituir: boolean }>>({});
  const [tipoReembolso, setTipoReembolso] = useState<"saldo_a_favor" | "reembolso_directo">("saldo_a_favor");
  const [metodoReembolso, setMetodoReembolso] = useState("efectivo");
  const [motivo, setMotivo] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [numeroNc, setNumeroNc] = useState("");

  const { mutate: crearNC, isPending } = useMutation({
    mutationFn: async () => {
      const itemsParaEnviar = Object.entries(selectedItems)
        .filter(([_, data]) => data.cantidad > 0)
        .map(([itemId, data]) => ({
          ventaItemId: itemId,
          cantidadDevuelta: data.cantidad,
          restituirStock: data.restituir,
        }));

      if (itemsParaEnviar.length === 0) throw new Error("Selecciona al menos un ítem");

      const res = await fetch("/api/notas-credito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ventaId,
          items: itemsParaEnviar,
          tipoReembolso,
          metodoReembolso: tipoReembolso === "reembolso_directo" ? metodoReembolso : null,
          motivo: motivo || null,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Error creando devolución");
      }

      const data = await res.json();
      return data;
    },
    onSuccess: (data) => {
      setNumeroNc(data.numeroNc);
      setShowSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["venta", ventaId] });
      queryClient.invalidateQueries({ queryKey: ["notas-credito", ventaId] });
      queryClient.invalidateQueries({ queryKey: ["saldo", clienteId] });
      if (tipoReembolso === "saldo_a_favor" && data.notaCreditoId) {
        window.open(`/nota-credito/${data.notaCreditoId}?autoPrint=1`, "_blank", "width=500,height=700");
      }
      setTimeout(() => {
        onSuccess();
        resetForm();
      }, 2000);
    },
  });

  const resetForm = () => {
    setStep(1);
    setSelectedItems({});
    setTipoReembolso("saldo_a_favor");
    setMetodoReembolso("efectivo");
    setMotivo("");
    setShowSuccess(false);
    setNumeroNc("");
    onClose();
  };

  const descuentoFactor = descuento > 0 ? (100 - descuento) / 100 : 1;

  const montoTotal = Object.entries(selectedItems)
    .filter(([_, data]) => data.cantidad > 0)
    .reduce((sum, [itemId, data]) => {
      const item = items.find((i) => i.id === itemId);
      return sum + (item ? Math.round(Number(item.precio_unitario) * data.cantidad * descuentoFactor) : 0);
    }, 0);

  const handleToggleItem = (itemId: string) => {
    setSelectedItems((prev) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return prev;

      const isSelected = prev[itemId]?.cantidad > 0;
      return {
        ...prev,
        [itemId]: {
          cantidad: isSelected ? 0 : item.cantidad,
          restituir: prev[itemId]?.restituir ?? true,
        },
      };
    });
  };

  const handleSetCantidad = (itemId: string, cantidad: number) => {
    const item = items.find((i) => i.id === itemId);
    if (!item || cantidad < 0 || cantidad > item.cantidad) return;

    setSelectedItems((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? { restituir: true }), cantidad },
    }));
  };

  if (!isOpen) return null;

  if (showSuccess) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 max-w-md text-center space-y-4">
          <div className="text-green-600 text-4xl">✓</div>
          <h2 className="font-bold text-lg">Devolución registrada</h2>
          <p className="text-sm text-gray-600">NC: {numeroNc}</p>
          <p className="text-sm text-gray-500">Redirigiendo...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
          <h2 className="font-bold">Devolución {step === 2 ? "- Paso 2" : "- Paso 1"}</h2>
          <button
            onClick={resetForm}
            className="text-gray-400 hover:text-gray-600"
            disabled={isPending}
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4">
          {step === 1 ? (
            <>
              <p className="text-sm text-gray-600">Selecciona los productos a devolver:</p>
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {items.map((item) => {
                  const prod = item.productos as unknown as { nombre: string } | null;
                  const selected = (selectedItems[item.id]?.cantidad ?? 0) > 0;

                  return (
                    <div
                      key={item.id}
                      className="border rounded-lg p-3 space-y-2 cursor-pointer hover:bg-gray-50"
                      onClick={() => handleToggleItem(item.id)}
                    >
                      <div className="flex gap-3">
                        <input
                          type="checkbox"
                          checked={selected}
                          readOnly
                          className="mt-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleItem(item.id);
                          }}
                        />
                        <div className="flex-1">
                          <p className="font-medium text-sm">{prod?.nombre ?? "Producto"}</p>
                          <p className="text-xs text-gray-500">
                            {descuento > 0 ? (
                              <>
                                <span className="line-through">${Math.round(Number(item.precio_unitario)).toLocaleString("es-CL")}</span>
                                {" "}${Math.round(Number(item.precio_unitario) * descuentoFactor).toLocaleString("es-CL")} c/u ({descuento}% desc.)
                              </>
                            ) : (
                              <>${Math.round(Number(item.precio_unitario)).toLocaleString("es-CL")} c/u</>
                            )}
                          </p>
                        </div>
                      </div>

                      {selected && (
                        <div className="ml-6 space-y-2">
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-600">Cantidad:</label>
                            <Input
                              type="number"
                              min={1}
                              max={item.cantidad}
                              value={selectedItems[item.id]?.cantidad ?? 1}
                              onChange={(e) =>
                                handleSetCantidad(item.id, parseInt(e.target.value) || 1)
                              }
                              className="w-16 h-8 text-xs"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") e.preventDefault();
                              }}
                            />
                            <span className="text-xs text-gray-500">/ {item.cantidad}</span>
                          </div>
                          <label className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={selectedItems[item.id]?.restituir ?? true}
                              readOnly
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedItems((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id]!, restituir: !(prev[item.id]?.restituir ?? true) },
                                }));
                              }}
                            />
                            <span>Restituir al stock</span>
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {montoTotal > 0 && (
                <div className="border-t pt-3">
                  <div className="flex justify-between font-medium text-sm">
                    <span>Monto a devolver:</span>
                    <span className="text-green-700">
                      ${Math.round(montoTotal).toLocaleString("es-CL")}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <Button variant="outline" onClick={resetForm} disabled={isPending} className="flex-1">
                  Cancelar
                </Button>
                <Button
                  onClick={() => montoTotal > 0 && setStep(2)}
                  disabled={montoTotal === 0}
                  className="flex-1"
                >
                  Continuar
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <p className="text-xs text-gray-600">Monto a devolver:</p>
                <p className="text-lg font-bold text-green-700">
                  ${Math.round(montoTotal).toLocaleString("es-CL")}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Tipo de reembolso:</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="reembolso"
                      value="saldo_a_favor"
                      checked={tipoReembolso === "saldo_a_favor"}
                      onChange={(e) => setTipoReembolso(e.target.value as "saldo_a_favor")}
                    />
                    <span>Nota de Crédito (voucher imprimible)</span>
                  </label>
                  <p className="text-xs text-gray-500 ml-6">
                    Se genera un voucher con vigencia de 30 días para usar en próximas compras
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="reembolso"
                      value="reembolso_directo"
                      checked={tipoReembolso === "reembolso_directo"}
                      onChange={(e) => setTipoReembolso(e.target.value as "reembolso_directo")}
                    />
                    <span>Reembolso directo</span>
                  </label>
                  {tipoReembolso === "reembolso_directo" && (
                    <select
                      value={metodoReembolso}
                      onChange={(e) => setMetodoReembolso(e.target.value)}
                      className="ml-6 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                    >
                      <option value="efectivo">Efectivo</option>
                      <option value="debito">Débito</option>
                      <option value="credito">Crédito</option>
                      <option value="transferencia">Transferencia</option>
                    </select>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Motivo (opcional):</label>
                <input
                  type="text"
                  placeholder="Ej: Producto defectuoso, cambio de opinión..."
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  className="w-full rounded-md border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                  disabled={isPending}
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  disabled={isPending}
                  className="flex-1"
                >
                  ← Atrás
                </Button>
                <Button
                  onClick={() => crearNC()}
                  disabled={isPending}
                  className="flex-1"
                >
                  {isPending ? "Procesando..." : "Confirmar devolución"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
