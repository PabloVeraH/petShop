"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { usePOSStore } from "@/stores/pos";
import { getClienteByRUT, getMascotasByCliente } from "../api";
import { formatRUT, validateRUT } from "@/lib/validation";

async function getFidelizacion(clienteId: string) {
  const res = await fetch(`/api/fidelizacion?clienteId=${clienteId}`);
  if (!res.ok) return null;
  return res.json() as Promise<{ total_historico: number; frecuencia_compras: number; descuento_actual: number } | null>;
}

interface ModalClienteProps {
  onClose: () => void;
}

export default function ModalCliente({ onClose }: ModalClienteProps) {
  const [rut, setRut] = useState("");
  const [selectedMascotaId, setSelectedMascotaId] = useState<string | undefined>();
  const { setCliente, clearCliente } = usePOSStore();

  const rutValido = validateRUT(rut);

  const { data: cliente, isLoading: loadingCliente, error } = useQuery({
    queryKey: ["cliente", rut],
    queryFn: () => getClienteByRUT(rut),
    enabled: rutValido,
    retry: false,
  });

  const { data: mascotas } = useQuery({
    queryKey: ["mascotas", cliente?.id],
    queryFn: () => getMascotasByCliente(cliente!.id),
    enabled: !!cliente?.id,
  });

  const { data: fidelizacion } = useQuery({
    queryKey: ["fidelizacion", cliente?.id],
    queryFn: () => getFidelizacion(cliente!.id),
    enabled: !!cliente?.id,
  });

  const handleConfirm = () => {
    if (cliente) {
      setCliente(cliente.id, selectedMascotaId, fidelizacion?.descuento_actual ?? 0);
    }
    onClose();
  };

  const handleSinCliente = () => {
    clearCliente();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <h2 className="text-base font-semibold mb-4">Seleccionar cliente</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              RUT del cliente
            </label>
            <Input
              placeholder="12.345.678-9"
              value={rut}
              onChange={(e) => setRut(e.target.value)}
              autoFocus
            />
            {rut && !rutValido && (
              <p className="text-xs text-red-500 mt-1">RUT inválido</p>
            )}
          </div>

          {loadingCliente && <p className="text-sm text-gray-400">Buscando...</p>}

          {error && (
            <p className="text-sm text-red-500">Error al buscar cliente</p>
          )}

          {rutValido && !loadingCliente && cliente === null && (
            <p className="text-sm text-yellow-600">
              Cliente no encontrado. Se registrará venta anónima.
            </p>
          )}

          {cliente && (
            <div className="rounded bg-green-50 p-3">
              <p className="text-sm font-medium text-green-800">{cliente.nombre}</p>
              <p className="text-xs text-green-600">
                RUT: {formatRUT(cliente.rut)}{cliente.email ? ` · ${cliente.email}` : ""}
              </p>
              {fidelizacion && (
                <p className="text-xs text-green-700 mt-1 font-medium">
                  Fidelización: {fidelizacion.descuento_actual}% desc.
                  <span className="font-normal text-green-600 ml-1">
                    (${Math.round(Number(fidelizacion.total_historico)).toLocaleString("es-CL")} histórico · {fidelizacion.frecuencia_compras} compras)
                  </span>
                </p>
              )}

              {mascotas && mascotas.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-gray-600 mb-2">Mascota (opcional)</p>
                  <div className="space-y-1">
                    {mascotas.map((m) => (
                      <button
                        key={m.id}
                        onClick={() =>
                          setSelectedMascotaId((prev) => (prev === m.id ? undefined : m.id))
                        }
                        className={`w-full text-left text-xs rounded px-2 py-1 transition-colors ${
                          selectedMascotaId === m.id
                            ? "bg-green-200 text-green-800"
                            : "bg-white hover:bg-green-100"
                        }`}
                      >
                        {m.nombre} ({m.tipo})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={handleSinCliente} className="flex-1">
              Sin cliente
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={rutValido && !loadingCliente && !cliente && rut !== ""}
              className="flex-1"
            >
              Confirmar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
