"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Proveedor = { id: string; nombre: string; rut: string | null; contacto: string | null; telefono: string | null; email: string | null };
type ProdRow = { id: string; costo: number | null; tiempo_entrega_dias: number | null; productos: { id: string; nombre: string; sku: string; stock: number } | null };
type DetalleProveedor = Proveedor & { productos: ProdRow[] };
type ProductoOpt = { id: string; nombre: string; sku: string };

const EMPTY_FORM = { nombre: "", rut: "", contacto: "", telefono: "", email: "" };

export default function SuppliersPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Proveedor | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [showAddProd, setShowAddProd] = useState(false);
  const [prodForm, setProdForm] = useState({ producto_id: "", costo: "", tiempo_entrega_dias: "3" });
  const queryClient = useQueryClient();

  const { data: proveedores, isLoading } = useQuery<Proveedor[]>({
    queryKey: ["proveedores", search],
    queryFn: async () => {
      const res = await fetch(`/api/proveedores?search=${search}`);
      return res.json();
    },
  });

  const { data: detalle } = useQuery<DetalleProveedor>({
    queryKey: ["proveedor", selected?.id],
    queryFn: async () => {
      const res = await fetch(`/api/proveedores/${selected!.id}`);
      return res.json();
    },
    enabled: !!selected?.id,
  });

  const { data: todosProductos } = useQuery<ProductoOpt[]>({
    queryKey: ["productos-all"],
    queryFn: async () => {
      const res = await fetch("/api/productos?search=");
      return res.json();
    },
    enabled: showAddProd,
  });

  const { mutate: createProveedor, isPending: creating } = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/proveedores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["proveedores"] }); setShowForm(false); setForm(EMPTY_FORM); setFormError(""); },
    onError: (e: Error) => setFormError(e.message),
  });

  const { mutate: deleteProveedor } = useMutation({
    mutationFn: async (id: string) => { await fetch(`/api/proveedores?id=${id}`, { method: "DELETE" }); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["proveedores"] }); setSelected(null); },
  });

  const { mutate: addProducto, isPending: addingProd } = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/proveedor-productos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proveedor_id: selected!.id, ...prodForm }) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["proveedor", selected?.id] }); setShowAddProd(false); setProdForm({ producto_id: "", costo: "", tiempo_entrega_dias: "3" }); },
  });

  const { mutate: removeProducto } = useMutation({
    mutationFn: async (id: string) => { await fetch(`/api/proveedor-productos?id=${id}`, { method: "DELETE" }); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proveedor", selected?.id] }),
  });

  return (
    <div className="flex gap-4 h-full">
      {/* Panel izquierdo */}
      <div className="w-2/5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Proveedores</h1>
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancelar" : "+ Nuevo"}</Button>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg shadow-sm p-3 space-y-2">
            {["nombre", "rut", "contacto", "telefono", "email"].map((field) => (
              <div key={field}>
                <label className="text-xs font-medium text-gray-600 block mb-0.5 capitalize">{field}{field === "nombre" ? " *" : ""}</label>
                <Input className="h-7 text-sm" value={(form as Record<string, string>)[field]} onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))} />
              </div>
            ))}
            {formError && <p className="text-xs text-red-500">{formError}</p>}
            <Button size="sm" className="w-full" onClick={() => { if (!form.nombre.trim()) { setFormError("Nombre requerido"); return; } createProveedor(); }} disabled={creating}>
              {creating ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        )}

        <Input placeholder="Buscar proveedor..." value={search} onChange={(e) => setSearch(e.target.value)} />

        <div className="flex-1 overflow-auto rounded-lg bg-white shadow-sm">
          {isLoading && <p className="text-sm text-gray-400 p-4 text-center">Cargando...</p>}
          {!isLoading && !proveedores?.length && <p className="text-sm text-gray-400 p-4 text-center">Sin proveedores</p>}
          {proveedores?.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelected(p)}
              className={`px-4 py-3 cursor-pointer border-b last:border-0 ${selected?.id === p.id ? "bg-green-50" : "hover:bg-gray-50"}`}
            >
              <p className="text-sm font-medium">{p.nombre}</p>
              <p className="text-xs text-gray-400">{p.rut ?? ""}{p.contacto ? ` · ${p.contacto}` : ""}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Panel derecho */}
      <div className="flex-1 rounded-lg bg-white shadow-sm p-5 overflow-auto">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">Selecciona un proveedor</div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">{detalle?.nombre ?? selected.nombre}</h2>
                {detalle?.rut && <p className="text-sm text-gray-500">RUT: {detalle.rut}</p>}
                {detalle?.telefono && <p className="text-xs text-gray-400">{detalle.telefono}</p>}
                {detalle?.email && <p className="text-xs text-gray-400">{detalle.email}</p>}
              </div>
              <Button variant="outline" size="sm" className="text-red-500 border-red-200 hover:bg-red-50" onClick={() => deleteProveedor(selected.id)}>
                Eliminar
              </Button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-gray-700">Productos que provee</p>
                <Button size="sm" variant="outline" onClick={() => setShowAddProd((v) => !v)}>+ Agregar</Button>
              </div>

              {showAddProd && (
                <div className="border rounded p-3 mb-3 space-y-2 bg-gray-50">
                  <select
                    value={prodForm.producto_id}
                    onChange={(e) => setProdForm((f) => ({ ...f, producto_id: e.target.value }))}
                    className="w-full rounded border border-input px-2 py-1.5 text-sm"
                  >
                    <option value="">Seleccionar producto...</option>
                    {todosProductos?.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.sku})</option>)}
                  </select>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-xs text-gray-600 block mb-1">Costo ($)</label>
                      <Input type="number" className="h-7 text-sm" value={prodForm.costo} onChange={(e) => setProdForm((f) => ({ ...f, costo: e.target.value }))} />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-600 block mb-1">Días entrega</label>
                      <Input type="number" className="h-7 text-sm" value={prodForm.tiempo_entrega_dias} onChange={(e) => setProdForm((f) => ({ ...f, tiempo_entrega_dias: e.target.value }))} />
                    </div>
                  </div>
                  <Button size="sm" className="w-full" disabled={!prodForm.producto_id || addingProd} onClick={() => addProducto()}>
                    {addingProd ? "Guardando..." : "Agregar"}
                  </Button>
                </div>
              )}

              {!detalle?.productos?.length ? (
                <p className="text-xs text-gray-400">Sin productos asignados</p>
              ) : (
                <div className="space-y-1">
                  {detalle.productos.map((pp) => {
                    const prod = pp.productos as unknown as { nombre: string; sku: string; stock: number } | null;
                    return (
                      <div key={pp.id} className="flex items-center justify-between rounded bg-gray-50 px-3 py-2 text-sm">
                        <div>
                          <span className="font-medium">{prod?.nombre}</span>
                          <span className="text-xs text-gray-400 ml-2">
                            {pp.costo ? `$${Number(pp.costo).toLocaleString("es-CL")}` : "sin costo"}
                            {pp.tiempo_entrega_dias ? ` · ${pp.tiempo_entrega_dias}d` : ""}
                            {` · Stock: ${prod?.stock ?? 0}`}
                          </span>
                        </div>
                        <button onClick={() => removeProducto(pp.id)} className="text-xs text-red-400 hover:text-red-600 ml-2">✕</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
