"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

type OrdenRow = { id: string; numero: string; estado: string; total: number; fecha_estimada: string | null; created_at: string; proveedores: { nombre: string } | null };
type OrdenDetalle = OrdenRow & { items: Array<{ id: string; cantidad_solicitada: number; cantidad_recibida: number | null; precio_unitario: number; subtotal: number; productos: { id: string; nombre: string; sku: string } | null }> };
type Proveedor = { id: string; nombre: string };
type ProductoOpt = { id: string; nombre: string; sku: string; precio: number };

const ESTADO_COLOR: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-700",
  recibida: "bg-green-100 text-green-700",
  cancelada: "bg-red-100 text-red-700",
};

export default function PurchasesPage() {
  const [estado, setEstado] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [showRecibir, setShowRecibir] = useState(false);
  const queryClient = useQueryClient();

  // Create form state
  const [proveedorId, setProveedorId] = useState("");
  const [fechaEstimada, setFechaEstimada] = useState("");
  const [orderItems, setOrderItems] = useState<Array<{ producto_id: string; nombre: string; cantidad_solicitada: number; precio_unitario: number; subtotal: number }>>([]);
  const [addingProd, setAddingProd] = useState({ producto_id: "", cantidad: "1", precio: "" });
  const [recibirCantidades, setRecibirCantidades] = useState<Record<string, number>>({});

  const { data: ordenes, isLoading } = useQuery<OrdenRow[]>({
    queryKey: ["ordenes-compra", estado],
    queryFn: async () => {
      const res = await fetch(`/api/ordenes-compra?estado=${estado}`);
      return res.json();
    },
  });

  const { data: proveedores } = useQuery<Proveedor[]>({
    queryKey: ["proveedores-list"],
    queryFn: async () => { const res = await fetch("/api/proveedores"); return res.json(); },
    enabled: showCreate,
  });

  const { data: productos } = useQuery<ProductoOpt[]>({
    queryKey: ["productos-activos"],
    queryFn: async () => { const res = await fetch("/api/inventario?search="); return res.json(); },
    enabled: showCreate,
  });

  const { data: ordenDetalle } = useQuery<OrdenDetalle>({
    queryKey: ["orden-detalle", viewId],
    queryFn: async () => { const res = await fetch(`/api/ordenes-compra/${viewId}`); return res.json(); },
    enabled: !!viewId,
  });

  const { mutate: createOrden, isPending: creating } = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ordenes-compra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedor_id: proveedorId, items: orderItems, fecha_estimada: fechaEstimada || null }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ordenes-compra"] });
      setShowCreate(false);
      setProveedorId(""); setFechaEstimada(""); setOrderItems([]);
    },
  });

  const { mutate: recibirOrden, isPending: recibiendo } = useMutation({
    mutationFn: async () => {
      const items = ordenDetalle!.items.map((i) => ({
        id: i.id,
        producto_id: (i.productos as unknown as { id: string } | null)?.id ?? "",
        cantidad_recibida: recibirCantidades[i.id] ?? i.cantidad_solicitada,
      }));
      const res = await fetch(`/api/ordenes-compra/${viewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recibir", items }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ordenes-compra"] });
      queryClient.invalidateQueries({ queryKey: ["orden-detalle", viewId] });
      setShowRecibir(false);
    },
  });

  const addItem = () => {
    const prod = productos?.find((p) => p.id === addingProd.producto_id);
    if (!prod) return;
    const cant = Number(addingProd.cantidad);
    const precio = Number(addingProd.precio) || prod.precio;
    setOrderItems((prev) => [...prev, { producto_id: prod.id, nombre: prod.nombre, cantidad_solicitada: cant, precio_unitario: precio, subtotal: cant * precio }]);
    setAddingProd({ producto_id: "", cantidad: "1", precio: "" });
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Órdenes de Compra</h1>
        <Button size="sm" onClick={() => setShowCreate(true)}>+ Nueva OC</Button>
      </div>

      <div className="flex gap-2">
        {["", "pendiente", "recibida", "cancelada"].map((e) => (
          <Button key={e} size="sm" variant={estado === e ? "default" : "outline"} onClick={() => setEstado(e)}>
            {e || "Todas"}
          </Button>
        ))}
      </div>

      <div className="flex-1 overflow-auto rounded-lg bg-white shadow-sm">
        {isLoading && <p className="text-sm text-gray-400 p-4 text-center">Cargando...</p>}
        {!isLoading && !ordenes?.length && <p className="text-sm text-gray-400 p-4 text-center">Sin órdenes</p>}
        {ordenes?.map((o) => {
          const prov = o.proveedores as unknown as { nombre: string } | null;
          return (
            <div key={o.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0 hover:bg-gray-50 cursor-pointer" onClick={() => setViewId(o.id)}>
              <div>
                <p className="text-sm font-medium">{o.numero}</p>
                <p className="text-xs text-gray-400">{prov?.nombre} · {new Date(o.created_at).toLocaleDateString("es-CL")}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-green-700">${Math.round(Number(o.total)).toLocaleString("es-CL")}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_COLOR[o.estado] ?? ""}`}>{o.estado}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal detalle / recibir */}
      {viewId && ordenDetalle && (
        <Dialog open onOpenChange={(open) => !open && setViewId(null)}>
          <DialogContent className="max-w-lg">
            <DialogTitle>{ordenDetalle.numero}</DialogTitle>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_COLOR[ordenDetalle.estado] ?? ""}`}>{ordenDetalle.estado}</span>
                <span className="text-sm text-gray-500">{(ordenDetalle.proveedores as unknown as { nombre: string } | null)?.nombre}</span>
              </div>

              <div className="space-y-1">
                {ordenDetalle.items.map((item) => {
                  const prod = item.productos as unknown as { nombre: string } | null;
                  return (
                    <div key={item.id} className="flex justify-between text-sm rounded bg-gray-50 px-3 py-2">
                      <span>{prod?.nombre} <span className="text-gray-400 text-xs">×{item.cantidad_solicitada}</span></span>
                      <span>${Math.round(item.subtotal).toLocaleString("es-CL")}</span>
                    </div>
                  );
                })}
              </div>

              <div className="text-right font-bold text-base">
                Total: ${Math.round(Number(ordenDetalle.total)).toLocaleString("es-CL")}
              </div>

              {ordenDetalle.estado === "pendiente" && (
                <Button className="w-full" onClick={() => {
                  const init: Record<string, number> = {};
                  ordenDetalle.items.forEach((i) => { init[i.id] = i.cantidad_solicitada; });
                  setRecibirCantidades(init);
                  setShowRecibir(true);
                }}>
                  Registrar recepción
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Modal recibir */}
      {showRecibir && ordenDetalle && (
        <Dialog open onOpenChange={(open) => !open && setShowRecibir(false)}>
          <DialogContent className="max-w-md">
            <DialogTitle>Recibir mercadería</DialogTitle>
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Ajusta las cantidades recibidas si difieren de lo solicitado.</p>
              {ordenDetalle.items.map((item) => {
                const prod = item.productos as unknown as { nombre: string } | null;
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3">
                    <span className="text-sm flex-1">{prod?.nombre}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">Solicitado: {item.cantidad_solicitada}</span>
                      <Input
                        type="number" min="0"
                        value={recibirCantidades[item.id] ?? item.cantidad_solicitada}
                        onChange={(e) => setRecibirCantidades((prev) => ({ ...prev, [item.id]: Number(e.target.value) }))}
                        className="w-20 h-7 text-sm"
                      />
                    </div>
                  </div>
                );
              })}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowRecibir(false)}>Cancelar</Button>
                <Button className="flex-1" disabled={recibiendo} onClick={() => recibirOrden()}>
                  {recibiendo ? "Procesando..." : "Confirmar recepción"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Modal crear OC */}
      {showCreate && (
        <Dialog open onOpenChange={(open) => !open && setShowCreate(false)}>
          <DialogContent className="max-w-lg">
            <DialogTitle>Nueva Orden de Compra</DialogTitle>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Proveedor *</label>
                <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className="w-full rounded border border-input px-2 py-1.5 text-sm">
                  <option value="">Seleccionar...</option>
                  {proveedores?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Fecha estimada entrega</label>
                <input type="date" value={fechaEstimada} onChange={(e) => setFechaEstimada(e.target.value)} className="w-full rounded border border-input px-2 py-1.5 text-sm" />
              </div>

              {/* Add items */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-700">Agregar productos</p>
                <div className="grid grid-cols-[1fr_80px_100px_auto] gap-2 items-end">
                  <div>
                    <label className="text-xs text-gray-500 mb-0.5 block">Producto</label>
                    <select value={addingProd.producto_id} onChange={(e) => setAddingProd((f) => ({ ...f, producto_id: e.target.value }))} className="w-full rounded border border-input px-2 py-1.5 text-sm">
                      <option value="">Seleccionar...</option>
                      {productos?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-0.5 block">Cant.</label>
                    <Input type="number" min="1" value={addingProd.cantidad} onChange={(e) => setAddingProd((f) => ({ ...f, cantidad: e.target.value }))} className="text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-0.5 block">Precio unit.</label>
                    <Input type="number" placeholder="Auto" value={addingProd.precio} onChange={(e) => setAddingProd((f) => ({ ...f, precio: e.target.value }))} className="text-sm" />
                  </div>
                  <Button variant="outline" onClick={addItem} disabled={!addingProd.producto_id} className="h-9">Agregar</Button>
                </div>
                {orderItems.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm bg-gray-50 rounded px-3 py-1.5">
                    <span>{item.nombre} ×{item.cantidad_solicitada}</span>
                    <div className="flex items-center gap-2">
                      <span>${Math.round(item.subtotal).toLocaleString("es-CL")}</span>
                      <button onClick={() => setOrderItems((prev) => prev.filter((_, j) => j !== i))} className="text-red-400 text-xs hover:text-red-600">✕</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>Cancelar</Button>
                <Button className="flex-1" disabled={!proveedorId || !orderItems.length || creating} onClick={() => createOrden()}>
                  {creating ? "Creando..." : "Crear OC"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
