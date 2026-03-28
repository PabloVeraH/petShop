"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ClientesTable from "./components/ClientesTable";
import ModalClienteCreate from "./components/ModalClienteCreate";
import ClienteDetalle from "./components/ClienteDetalle";
import type { Cliente } from "@/types";

const LIMIT = 50;

async function getClientes(
  search: string,
  offset: number
): Promise<{ data: Cliente[]; count: number }> {
  const params = new URLSearchParams({ search, offset: String(offset) });
  const res = await fetch(`/api/clientes?${params}`);
  if (!res.ok) throw new Error("Error al cargar clientes");
  return res.json();
}

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Cliente | null>(null);
  const [showModal, setShowModal] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["clientes", search, offset],
    queryFn: () => getClientes(search, offset),
  });

  const clientes = data?.data ?? [];
  const total = data?.count ?? 0;

  return (
    <div className="flex gap-4 h-full">
      {/* Panel izquierdo: lista */}
      <div className="w-2/5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Clientes</h1>
          <Button size="sm" onClick={() => setShowModal(true)}>
            + Nuevo
          </Button>
        </div>

        <Input
          placeholder="Buscar por nombre o RUT..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
            setSelected(null);
          }}
        />

        <div className="flex-1 overflow-auto rounded-lg bg-white shadow-sm">
          {isLoading ? (
            <p className="text-sm text-gray-400 p-4 text-center">Cargando...</p>
          ) : (
            <ClientesTable
              data={clientes}
              selectedId={selected?.id}
              onSelect={setSelected}
            />
          )}
        </div>

        {total > LIMIT && (
          <div className="flex justify-between items-center text-xs text-gray-500">
            <span>
              {offset + 1}–{Math.min(offset + LIMIT, total)} de {total}
            </span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset((o) => o - LIMIT)}
              >
                Ant.
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + LIMIT >= total}
                onClick={() => setOffset((o) => o + LIMIT)}
              >
                Sig.
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Panel derecho: detalle */}
      <div className="flex-1 rounded-lg bg-white shadow-sm p-5 overflow-auto">
        {selected ? (
          <ClienteDetalle
            cliente={selected}
            onRefresh={() =>
              queryClient.invalidateQueries({ queryKey: ["clientes"] })
            }
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Selecciona un cliente para ver su detalle
          </div>
        )}
      </div>

      {showModal && (
        <ModalClienteCreate
          onClose={() => {
            setShowModal(false);
            queryClient.invalidateQueries({ queryKey: ["clientes"] });
          }}
        />
      )}
    </div>
  );
}
