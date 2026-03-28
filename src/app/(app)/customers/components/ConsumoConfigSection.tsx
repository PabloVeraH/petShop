"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ConsumoConfig = {
  id: string;
  mascota_id: string;
  producto_id: string;
  gramos_porcion: number;
  veces_dia: number;
  productos: { nombre: string; peso_gramos: number | null } | null;
};

type ProductoOption = {
  id: string;
  nombre: string;
  peso_gramos: number | null;
};

async function getConfigs(mascotaId: string): Promise<ConsumoConfig[]> {
  const res = await fetch(`/api/consumo-configs?mascotaId=${mascotaId}`);
  if (!res.ok) throw new Error("Error al cargar configs");
  return res.json();
}

async function getProductos(): Promise<ProductoOption[]> {
  const res = await fetch("/api/productos?search=");
  if (!res.ok) throw new Error("Error al cargar productos");
  return res.json();
}

export default function ConsumoConfigSection({ mascotaId }: { mascotaId: string }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ producto_id: "", gramos_porcion: "", veces_dia: "2" });
  const [error, setError] = useState("");

  const queryClient = useQueryClient();

  const { data: configs, isLoading } = useQuery({
    queryKey: ["consumo-configs", mascotaId],
    queryFn: () => getConfigs(mascotaId),
  });

  const { data: productos } = useQuery({
    queryKey: ["productos-all"],
    queryFn: getProductos,
    enabled: showForm,
  });

  const { mutate: saveConfig, isPending: isSaving } = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/consumo-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mascota_id: mascotaId,
          producto_id: form.producto_id,
          gramos_porcion: Number(form.gramos_porcion),
          veces_dia: Number(form.veces_dia),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Error al guardar");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumo-configs", mascotaId] });
      setShowForm(false);
      setForm({ producto_id: "", gramos_porcion: "", veces_dia: "2" });
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const { mutate: deleteConfig } = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/consumo-configs?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["consumo-configs", mascotaId] }),
  });

  const handleSave = () => {
    if (!form.producto_id) { setError("Selecciona un producto"); return; }
    if (!form.gramos_porcion || Number(form.gramos_porcion) <= 0) { setError("Ingresa gramos/porción"); return; }
    if (!form.veces_dia || Number(form.veces_dia) <= 0) { setError("Ingresa veces/día"); return; }
    saveConfig();
  };

  const calcDias = (config: ConsumoConfig) => {
    const peso = config.productos?.peso_gramos;
    if (!peso) return null;
    const diario = config.gramos_porcion * config.veces_dia;
    return Math.round(peso / diario);
  };

  if (isLoading) return <p className="text-xs text-gray-400">Cargando consumo...</p>;

  return (
    <div className="mt-2 space-y-2">
      {configs && configs.length > 0 && (
        <div className="space-y-1">
          {configs.map((c) => {
            const prod = c.productos as unknown as { nombre: string; peso_gramos: number | null } | null;
            const dias = calcDias({ ...c, productos: prod });
            return (
              <div key={c.id} className="flex items-center justify-between bg-blue-50 rounded px-2 py-1.5 text-xs">
                <div>
                  <span className="font-medium">{prod?.nombre ?? "Producto"}</span>
                  <span className="text-gray-500 ml-2">
                    {c.gramos_porcion}g × {c.veces_dia}/día
                    {dias ? ` · ~${dias} días/bolsa` : ""}
                  </span>
                </div>
                <button
                  onClick={() => deleteConfig(c.id)}
                  className="text-red-400 hover:text-red-600 ml-2"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="text-xs text-blue-600 hover:underline"
        >
          + Configurar consumo
        </button>
      )}

      {showForm && (
        <div className="border rounded p-2 space-y-2 bg-gray-50">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Producto *</label>
            <select
              value={form.producto_id}
              onChange={(e) => setForm((f) => ({ ...f, producto_id: e.target.value }))}
              className="w-full rounded border border-input bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Seleccionar...</option>
              {productos?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}{p.peso_gramos ? ` (${p.peso_gramos}g)` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-600 block mb-1">Gramos/porción *</label>
              <Input
                type="number"
                min="1"
                value={form.gramos_porcion}
                onChange={(e) => setForm((f) => ({ ...f, gramos_porcion: e.target.value }))}
                className="text-xs h-7"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-600 block mb-1">Veces/día *</label>
              <Input
                type="number"
                min="1"
                value={form.veces_dia}
                onChange={(e) => setForm((f) => ({ ...f, veces_dia: e.target.value }))}
                className="text-xs h-7"
              />
            </div>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setError(""); }} className="flex-1 h-7 text-xs">
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving} className="flex-1 h-7 text-xs">
              {isSaving ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
