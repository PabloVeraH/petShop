"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import type { LoteProducto } from "@/types";
import { estadoSacos, formatoSacos } from "@/lib/granel";

// D22 — Ajuste por conteo físico: fija el stock al valor contado (por lote si
// el producto tiene lotes), con motivo obligatorio. Solo se muestra a admin
// (conveniencia de UX); el control real es el servidor
// (POST /api/inventario/[id]/conteo exige storeAdmin/systemAdmin).
// Granel (migración 077): se cuentan los sacos CERRADOS y, aparte, los gramos
// del saco abierto (vacío = no se contaron; 0 = cierra el saco abierto).

interface ConteoFisicoModalProps {
  producto: {
    id: string;
    nombre: string;
    stock: number;
    precio_venta_kg?: number | null;
    peso_gramos?: number | null;
    saco_abierto_gramos?: number | null;
  };
  onClose: () => void;
}

async function getLotesActivos(productoId: string): Promise<LoteProducto[]> {
  const res = await fetch(`/api/lotes?${new URLSearchParams({ producto_id: productoId })}`);
  if (!res.ok) throw new Error("Error al cargar lotes");
  const data = await res.json();
  return data.lotes ?? [];
}

export function ConteoFisicoModal({ producto, onClose }: ConteoFisicoModalProps) {
  const queryClient = useQueryClient();
  const [loteId, setLoteId] = useState("");
  const [contado, setContado] = useState("");
  const [gramos, setGramos] = useState("");
  const [motivo, setMotivo] = useState("");

  const { data: lotes = [], isLoading, isError } = useQuery({
    queryKey: ["lotes", producto.id],
    queryFn: () => getLotesActivos(producto.id),
  });
  const esGranel = (producto.precio_venta_kg ?? 0) > 0 && (producto.peso_gramos ?? 0) > 0;
  const sacos = esGranel ? estadoSacos(producto) : null;
  const tieneLotes = lotes.length > 0;
  const loteSel = lotes.find((l) => l.id === loteId);
  const cantidadActual = tieneLotes
    ? (loteSel ? Number(loteSel.cantidad_actual) : null)
    : sacos ? sacos.cerrados : Number(producto.stock);

  const motivoValido = motivo.trim().length >= 5;
  const contadoNum = Number(contado);
  const contadoValido = contado !== "" && Number.isFinite(contadoNum) && contadoNum >= 0;
  const gramosNum = Number(gramos);
  const gramosValido = gramos === "" || (Number.isInteger(gramosNum) && gramosNum >= 0);
  const puedeEnviar = contadoValido && motivoValido && gramosValido && (!tieneLotes || !!loteId);

  const { mutate: registrar, isPending, error, reset } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/inventario/${producto.id}/conteo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stock_contado: contadoNum,
          motivo: motivo.trim(),
          ...(tieneLotes ? { lote_id: loteId } : {}),
          ...(esGranel && gramos !== "" ? { gramos_saco_abierto: gramosNum } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al registrar el conteo");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventario"], refetchType: "all" });
      queryClient.invalidateQueries({ queryKey: ["productos"], refetchType: "all" });
      queryClient.invalidateQueries({ queryKey: ["lotes", producto.id] });
      onClose();
    },
  });

  return (
    <ModalOverlay open onClose={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm m-4">
        <h3 className="text-base font-semibold text-gray-800 mb-1">Conteo físico</h3>
        <p className="text-sm text-gray-500 mb-4">
          {producto.nombre} — stock en sistema: {sacos ? formatoSacos(sacos.cerrados, sacos.gramosAbiertos) : producto.stock}
        </p>

        {isLoading && <p className="text-sm text-gray-400">Cargando lotes...</p>}
        {isError && <p className="text-sm text-red-500">Error al cargar lotes.</p>}

        {!isLoading && !isError && (
          <div className="space-y-3">
            {tieneLotes && (
              <div>
                <label htmlFor="conteo-lote" className="block text-sm font-medium text-gray-700 mb-1">Lote contado *</label>
                <select
                  id="conteo-lote"
                  value={loteId}
                  onChange={(e) => { setLoteId(e.target.value); reset(); }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">Selecciona un lote</option>
                  {lotes.map((l) => (
                    <option key={l.id} value={l.id}>
                      {(l.numero_lote ?? "Sin número")} — vence {l.fecha_vencimiento.split("T")[0]} — {l.cantidad_actual} u.
                    </option>
                  ))}
                </select>
              </div>
            )}
            {cantidadActual !== null && (
              <p className="text-xs text-gray-500">Cantidad registrada: {cantidadActual}</p>
            )}
            <div>
              <label htmlFor="conteo-cantidad" className="block text-sm font-medium text-gray-700 mb-1">
                {sacos ? "Sacos cerrados contados *" : "Cantidad contada *"}
              </label>
              <input
                id="conteo-cantidad"
                type="number"
                min={0}
                step="0.001"
                value={contado}
                onChange={(e) => { setContado(e.target.value); reset(); }}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            {sacos && (
              <div>
                <label htmlFor="conteo-gramos" className="block text-sm font-medium text-gray-700 mb-1">
                  Gramos en el saco abierto
                </label>
                <input
                  id="conteo-gramos"
                  type="number"
                  min={0}
                  step="1"
                  value={gramos}
                  onChange={(e) => { setGramos(e.target.value); reset(); }}
                  placeholder={`Registrado: ${sacos.gramosAbiertos} g (vacío = sin cambio)`}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
                {!gramosValido && (
                  <p className="text-xs text-red-500 mt-1">Los gramos deben ser un entero mayor o igual a 0</p>
                )}
              </div>
            )}
            <div>
              <label htmlFor="conteo-motivo" className="block text-sm font-medium text-gray-700 mb-1">Motivo *</label>
              <input
                id="conteo-motivo"
                type="text"
                maxLength={255}
                value={motivo}
                onChange={(e) => { setMotivo(e.target.value); reset(); }}
                placeholder="Ej: conteo de fin de mes"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
              {motivo.length > 0 && !motivoValido && (
                <p className="text-xs text-red-500 mt-1">El motivo debe tener al menos 5 caracteres</p>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-500 mt-3">{error.message}</p>}

        <div className="flex gap-2 mt-5">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={() => registrar()} disabled={isPending || !puedeEnviar} className="flex-1">
            {isPending ? "Guardando..." : "Registrar conteo"}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
