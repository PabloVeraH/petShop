"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Producto = {
  id: string;
  nombre: string;
  sku: string;
  precio: number;
  stock: number;
  stock_minimo: number;
};

type AjusteModal = { producto: Producto; tipo: "entrada" | "salida" } | null;

async function getInventario(search: string, soloAlertas: boolean): Promise<Producto[]> {
  const params = new URLSearchParams({ search });
  if (soloAlertas) params.set("alertas", "1");
  const res = await fetch(`/api/inventario?${params}`);
  if (!res.ok) throw new Error("Error al cargar inventario");
  return res.json();
}

export default function InventoryPage() {
  const [search, setSearch] = useState("");
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [ajuste, setAjuste] = useState<AjusteModal>(null);
  const [ajusteCantidad, setAjusteCantidad] = useState("1");
  const [ajusteNotas, setAjusteNotas] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["inventario", search, soloAlertas],
    queryFn: () => getInventario(search, soloAlertas),
  });

  const { mutate: aplicarAjuste, isPending: guardandoAjuste } = useMutation({
    mutationFn: () =>
      fetch(`/api/inventario/${ajuste!.producto.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: ajuste!.tipo,
          cantidad: Number(ajusteCantidad),
          notas: ajusteNotas || undefined,
        }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventario"] });
      setAjuste(null);
      setAjusteCantidad("1");
      setAjusteNotas("");
    },
  });

  const productos = data ?? [];
  const totalAlertas = data?.filter((p) => p.stock <= p.stock_minimo).length ?? 0;

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Inventario</h1>
        {totalAlertas > 0 && !soloAlertas && (
          <span className="text-xs font-medium text-red-600 bg-red-50 px-3 py-1 rounded-full">
            {totalAlertas} producto{totalAlertas > 1 ? "s" : ""} bajo stock mínimo
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Buscar por nombre o SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button
          variant={soloAlertas ? "default" : "outline"}
          size="sm"
          onClick={() => setSoloAlertas((v) => !v)}
        >
          Solo alertas
        </Button>
      </div>

      <div className="flex-1 overflow-auto rounded-lg bg-white shadow-sm">
        {isLoading && (
          <p className="text-sm text-gray-400 p-4 text-center">Cargando...</p>
        )}
        {isError && (
          <p className="text-sm text-red-500 p-4 text-center">Error al cargar inventario.</p>
        )}
        {!isLoading && !isError && productos.length === 0 && (
          <p className="text-sm text-gray-400 p-4 text-center">
            {soloAlertas ? "Sin productos en alerta" : "Sin productos"}
          </p>
        )}
        {!isLoading && !isError && productos.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Stock mín.</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Ajustar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productos.map((p) => {
                const enAlerta = p.stock <= p.stock_minimo;
                return (
                  <TableRow key={p.id} className={enAlerta ? "bg-red-50" : undefined}>
                    <TableCell className="font-medium">{p.nombre}</TableCell>
                    <TableCell className="text-gray-500 text-sm">{p.sku}</TableCell>
                    <TableCell className="text-right">
                      ${p.precio.toLocaleString("es-CL")}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {p.stock}
                    </TableCell>
                    <TableCell className="text-right text-gray-500">
                      {p.stock_minimo}
                    </TableCell>
                    <TableCell>
                      {enAlerta ? (
                        <Badge variant="destructive">Bajo stock</Badge>
                      ) : (
                        <Badge variant="secondary">OK</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <button
                          onClick={() => { setAjuste({ producto: p, tipo: "entrada" }); setAjusteCantidad("1"); setAjusteNotas(""); }}
                          className="px-2 py-1 text-xs rounded bg-green-50 text-green-700 hover:bg-green-100 border border-green-200"
                          title="Entrada de stock"
                        >
                          +
                        </button>
                        <button
                          onClick={() => { setAjuste({ producto: p, tipo: "salida" }); setAjusteCantidad("1"); setAjusteNotas(""); }}
                          className="px-2 py-1 text-xs rounded bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                          title="Salida de stock"
                        >
                          −
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Modal ajuste de stock */}
      {ajuste && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-gray-800 mb-1">
              {ajuste.tipo === "entrada" ? "Entrada de stock" : "Salida de stock"}
            </h3>
            <p className="text-sm text-gray-500 mb-4">{ajuste.producto.nombre} — stock actual: {ajuste.producto.stock}</p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad</label>
                <input
                  type="number"
                  min={1}
                  value={ajusteCantidad}
                  onChange={(e) => setAjusteCantidad(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Motivo (opcional)</label>
                <input
                  type="text"
                  value={ajusteNotas}
                  onChange={(e) => setAjusteNotas(e.target.value)}
                  placeholder="Ej: conteo físico, devolución, merma..."
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <Button variant="outline" onClick={() => setAjuste(null)} className="flex-1">
                Cancelar
              </Button>
              <Button
                onClick={() => aplicarAjuste()}
                disabled={guardandoAjuste || !ajusteCantidad || Number(ajusteCantidad) <= 0}
                className={`flex-1 ${ajuste.tipo === "salida" ? "bg-red-600 hover:bg-red-700" : ""}`}
              >
                {guardandoAjuste ? "Guardando..." : ajuste.tipo === "entrada" ? "Agregar" : "Descontar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
