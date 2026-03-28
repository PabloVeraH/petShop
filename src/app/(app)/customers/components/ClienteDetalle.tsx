"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatRUT } from "@/lib/validation";
import ModalMascotaCreate from "./ModalMascotaCreate";
import ConsumoConfigSection from "./ConsumoConfigSection";
import type { Cliente } from "@/types";

type MascotaItem = {
  id: string;
  nombre: string;
  tipo: string;
  raza?: string | null;
  peso_kg?: number | null;
};

type VentaItem = {
  id: string;
  total: number;
  metodo_pago: string | null;
  created_at: string;
};

type DetalleData = Cliente & {
  mascotas: MascotaItem[];
  ventas: VentaItem[];
};

export default function ClienteDetalle({
  cliente,
}: {
  cliente: Cliente;
  onRefresh: () => void;
}) {
  const [showMascotaModal, setShowMascotaModal] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<DetalleData>({
    queryKey: ["cliente-detalle", cliente.id],
    queryFn: async () => {
      const res = await fetch(`/api/clientes/${cliente.id}`);
      if (!res.ok) throw new Error("Error al cargar detalle");
      return res.json();
    },
  });

  if (isLoading) return <p className="text-sm text-gray-400">Cargando...</p>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-gray-900">{data.nombre}</h2>
        <p className="text-sm text-gray-500">{formatRUT(data.rut)}</p>
        {data.email && <p className="text-xs text-gray-400">{data.email}</p>}
        {data.telefono && <p className="text-xs text-gray-400">{data.telefono}</p>}
      </div>

      {/* Mascotas */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-gray-700">Mascotas</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowMascotaModal(true)}
          >
            + Agregar
          </Button>
        </div>
        {data.mascotas.length === 0 ? (
          <p className="text-xs text-gray-400">Sin mascotas registradas</p>
        ) : (
          <div className="space-y-1">
            {data.mascotas.map((m) => (
              <div key={m.id} className="rounded bg-gray-50 px-3 py-2 text-sm">
                <span className="font-medium">{m.nombre}</span>
                <span className="text-gray-400 ml-2 text-xs">
                  {m.tipo}
                  {m.raza ? ` · ${m.raza}` : ""}
                  {m.peso_kg ? ` · ${m.peso_kg}kg` : ""}
                </span>
                <ConsumoConfigSection mascotaId={m.id} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historial compras */}
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-2">Últimas compras</p>
        {data.ventas.length === 0 ? (
          <p className="text-xs text-gray-400">Sin compras aún</p>
        ) : (
          <div className="space-y-1">
            {data.ventas.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between text-sm border-b last:border-0 py-1.5"
              >
                <span className="text-gray-500 text-xs">
                  {new Date(v.created_at).toLocaleDateString("es-CL")} ·{" "}
                  {v.metodo_pago ?? "efectivo"}
                </span>
                <span className="font-medium text-green-700">
                  ${Math.round(Number(v.total)).toLocaleString("es-CL")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showMascotaModal && (
        <ModalMascotaCreate
          clienteId={cliente.id}
          onClose={() => {
            setShowMascotaModal(false);
            queryClient.invalidateQueries({ queryKey: ["cliente-detalle", cliente.id] });
          }}
        />
      )}
    </div>
  );
}
