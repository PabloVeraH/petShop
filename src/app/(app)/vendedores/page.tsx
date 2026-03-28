"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type Vendedor = {
  id: string;
  nombre: string;
  rut: string | null;
  meta_ventas: number | null;
  ventas_mes: number;
};

async function getVendedores(): Promise<Vendedor[]> {
  const res = await fetch("/api/vendedores");
  if (!res.ok) throw new Error("Error al cargar vendedores");
  return res.json();
}

export default function VendedoresPage() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nombre: "", rut: "", meta_ventas: "" });
  const [error, setError] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["vendedores"],
    queryFn: getVendedores,
  });

  const { mutate: createVendedor, isPending } = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/vendedores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Error"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendedores"] });
      setShowForm(false);
      setForm({ nombre: "", rut: "", meta_ventas: "" });
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const { mutate: deleteVendedor } = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/vendedores?id=${id}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vendedores"] }),
  });

  const handleCreate = () => {
    if (!form.nombre.trim()) { setError("Nombre requerido"); return; }
    createVendedor();
  };

  const vendedores = (data ?? []).sort((a, b) => b.ventas_mes - a.ventas_mes);

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Vendedores</h1>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancelar" : "+ Nuevo"}
        </Button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow-sm p-4 space-y-3 max-w-sm">
          <h2 className="text-sm font-semibold">Nuevo vendedor</h2>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Nombre *</label>
            <Input value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">RUT</label>
            <Input value={form.rut} onChange={(e) => setForm((f) => ({ ...f, rut: e.target.value }))} placeholder="12.345.678-9" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Meta mensual ($)</label>
            <Input type="number" value={form.meta_ventas} onChange={(e) => setForm((f) => ({ ...f, meta_ventas: e.target.value }))} />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <Button onClick={handleCreate} disabled={isPending} size="sm" className="w-full">
            {isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-lg bg-white shadow-sm">
        {isLoading && <p className="text-sm text-gray-400 p-4 text-center">Cargando...</p>}
        {isError && <p className="text-sm text-red-500 p-4 text-center">Error al cargar.</p>}
        {!isLoading && !isError && vendedores.length === 0 && (
          <p className="text-sm text-gray-400 p-4 text-center">Sin vendedores registrados</p>
        )}
        {!isLoading && !isError && vendedores.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ranking</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>RUT</TableHead>
                <TableHead className="text-right">Ventas mes</TableHead>
                <TableHead className="text-right">Meta</TableHead>
                <TableHead className="text-right">Avance</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendedores.map((v, i) => {
                const avance = v.meta_ventas && v.meta_ventas > 0
                  ? Math.round((v.ventas_mes / v.meta_ventas) * 100)
                  : null;
                return (
                  <TableRow key={v.id}>
                    <TableCell className="font-bold text-gray-400 text-sm">#{i + 1}</TableCell>
                    <TableCell className="font-medium">{v.nombre}</TableCell>
                    <TableCell className="text-gray-500 text-sm">{v.rut ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium text-green-700">
                      ${Math.round(v.ventas_mes).toLocaleString("es-CL")}
                    </TableCell>
                    <TableCell className="text-right text-gray-500 text-sm">
                      {v.meta_ventas ? `$${Math.round(v.meta_ventas).toLocaleString("es-CL")}` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {avance !== null ? (
                        <span className={`text-sm font-medium ${avance >= 100 ? "text-green-600" : avance >= 50 ? "text-yellow-600" : "text-red-500"}`}>
                          {avance}%
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => deleteVendedor(v.id)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Eliminar
                      </button>
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
