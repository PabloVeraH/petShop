"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

  const { data, isLoading, isError } = useQuery({
    queryKey: ["inventario", search, soloAlertas],
    queryFn: () => getInventario(search, soloAlertas),
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
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
