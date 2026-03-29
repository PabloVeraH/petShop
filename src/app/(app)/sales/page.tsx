"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const LIMIT = 50;

const METODOS = [
  { value: "", label: "Todos los métodos" },
  { value: "efectivo", label: "Efectivo" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
  { value: "transferencia", label: "Transferencia" },
];

const ESTADOS = [
  { value: "", label: "Todos los estados" },
  { value: "completada", label: "Completadas" },
  { value: "anulada", label: "Anuladas" },
];

type VentaRow = {
  id: string;
  total: number;
  metodo_pago: string | null;
  estado: string;
  created_at: string;
  clientes: { nombre: string } | null;
};

async function getVentas(params: {
  search: string;
  metodo: string;
  desde: string;
  hasta: string;
  offset: number;
}): Promise<{ data: VentaRow[]; count: number }> {
  const p = new URLSearchParams({
    search: params.search,
    metodo: params.metodo,
    desde: params.desde,
    hasta: params.hasta,
    offset: String(params.offset),
  });
  const res = await fetch(`/api/ventas?${p}`);
  if (!res.ok) throw new Error("Error al cargar ventas");
  return res.json();
}

export default function SalesPage() {
  const [search, setSearch] = useState("");
  const [metodo, setMetodo] = useState("");
  const [estado, setEstado] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [offset, setOffset] = useState(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["ventas", search, metodo, estado, desde, hasta, offset],
    queryFn: () => getVentas({ search, metodo, desde, hasta, offset }),
  });

  const total = data?.count ?? 0;

  const resetFiltros = () => {
    setSearch(""); setMetodo(""); setEstado(""); setDesde(""); setHasta(""); setOffset(0);
  };

  const ventas = (data?.data ?? []).filter((v) => !estado || v.estado === estado);

  return (
    <div className="flex flex-col gap-4 h-full">
      <h1 className="text-xl font-bold text-gray-900">Historial de Ventas</h1>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-end">
        <Input
          placeholder="Buscar por cliente..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          className="w-48"
        />
        <select
          value={metodo}
          onChange={(e) => { setMetodo(e.target.value); setOffset(0); }}
          className="rounded-md border border-input bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
        >
          {METODOS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <select
          value={estado}
          onChange={(e) => { setEstado(e.target.value); setOffset(0); }}
          className="rounded-md border border-input bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
        >
          {ESTADOS.map((e) => (
            <option key={e.value} value={e.value}>{e.label}</option>
          ))}
        </select>
        <div className="flex items-center gap-1 text-sm text-gray-500">
          <span>Desde</span>
          <input
            type="date"
            value={desde}
            onChange={(e) => { setDesde(e.target.value); setOffset(0); }}
            className="rounded-md border border-input px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
          />
        </div>
        <div className="flex items-center gap-1 text-sm text-gray-500">
          <span>Hasta</span>
          <input
            type="date"
            value={hasta}
            onChange={(e) => { setHasta(e.target.value); setOffset(0); }}
            className="rounded-md border border-input px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
          />
        </div>
        {(search || metodo || estado || desde || hasta) && (
          <Button variant="outline" size="sm" onClick={resetFiltros}>
            Limpiar
          </Button>
        )}
      </div>

      {/* Tabla */}
      <div className="flex-1 overflow-auto rounded-lg bg-white shadow-sm">
        {isLoading && (
          <p className="text-sm text-gray-400 p-4 text-center">Cargando...</p>
        )}
        {isError && (
          <p className="text-sm text-red-500 p-4 text-center">Error al cargar ventas.</p>
        )}
        {!isLoading && !isError && ventas.length === 0 && (
          <p className="text-sm text-gray-400 p-4 text-center">Sin ventas</p>
        )}
        {!isLoading && !isError && ventas.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Método</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ventas.map((v) => {
                const cliente = v.clientes as unknown as { nombre: string } | null;
                return (
                  <TableRow key={v.id}>
                    <TableCell className="text-sm text-gray-500">
                      {new Date(v.created_at).toLocaleString("es-CL", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </TableCell>
                    <TableCell className="text-sm">
                      {cliente?.nombre ?? <span className="text-gray-400">Sin cliente</span>}
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {v.metodo_pago ?? "—"}
                    </TableCell>
                    <TableCell>
                      {v.estado === "anulada"
                        ? <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Anulada</span>
                        : <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Completada</span>
                      }
                    </TableCell>
                    <TableCell className={`text-right font-medium ${v.estado === "anulada" ? "text-gray-400 line-through" : "text-green-700"}`}>
                      ${Math.round(Number(v.total)).toLocaleString("es-CL")}
                    </TableCell>
                    <TableCell>
                      <Link href={`/sales/${v.id}`} className="text-xs text-blue-500 hover:underline">
                        Ver ticket
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Paginación */}
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
  );
}
