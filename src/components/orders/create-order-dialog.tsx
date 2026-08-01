"use client";

import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ProductoOpt {
  id: string;
  nombre: string;
  sku: string;
  precio: number;
}

interface OrderItem {
  producto_id: string | null;
  nombre_nuevo: string;
  nombre: string;
  cantidad: string;
  esNuevo: boolean;
}

interface CreateOrderDialogProps {
  open: boolean;
  onClose: () => void;
  proveedorId: string;
  productos: ProductoOpt[];
  onOrderCreated: () => void;
}

export default function CreateOrderDialog({ open, onClose, proveedorId, productos, onOrderCreated }: CreateOrderDialogProps) {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [addingItem, setAddingItem] = useState({ producto_id: "", nombre_nuevo: "", cantidad: "1", esNuevo: false });
  const [fechaEstimada, setFechaEstimada] = useState("");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  const prevOpen = useRef(open);

  // Notas siguen opcionales, pero si se escribe algo debe alcanzar para
  // trazabilidad real (ticket Trello 6a62eb3057bc5972b4ca8dcc);
  // OrdenCompraCreateSchema aplica la misma regla como defensa server-side.
  const notasError = notas.trim().length > 0 && notas.trim().length < 5;

  const resetForm = () => {
    setItems([]);
    setAddingItem({ producto_id: "", nombre_nuevo: "", cantidad: "1", esNuevo: false });
    setFechaEstimada("");
    setNotas("");
    setError("");
  };

  useEffect(() => {
    if (open && !prevOpen.current) {
      resetForm();
    }
    prevOpen.current = open;
  }, [open]);

  const addOrderItem = () => {
    if (addingItem.esNuevo) {
      if (!addingItem.nombre_nuevo.trim()) return;
      setItems(prev => [...prev, {
        producto_id: null,
        nombre_nuevo: addingItem.nombre_nuevo.trim(),
        nombre: addingItem.nombre_nuevo.trim(),
        cantidad: addingItem.cantidad,
        esNuevo: true,
      }]);
    } else {
      const prod = productos.find(p => p.id === addingItem.producto_id);
      if (!prod) return;
      setItems(prev => [...prev, {
        producto_id: prod.id,
        nombre_nuevo: "",
        nombre: prod.nombre,
        cantidad: addingItem.cantidad,
        esNuevo: false,
      }]);
    }
    setAddingItem({ producto_id: "", nombre_nuevo: "", cantidad: "1", esNuevo: false });
  };

  const removeOrderItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleCreate = async () => {
    setError("");
    if (items.length === 0) {
      setError("Debe agregar al menos un producto a la orden");
      return;
    }

    setIsPending(true);
    try {
      const payload: Record<string, unknown> = {
        proveedor_id: proveedorId,
        items: items.map(item => ({
          producto_id: item.producto_id ?? undefined,
          nombre_nuevo: item.esNuevo ? item.nombre_nuevo : undefined,
          cantidad_solicitada: Number(item.cantidad),
        })),
      };
      if (fechaEstimada) payload.fecha_estimada = new Date(fechaEstimada).toISOString();
      if (notas.trim()) payload.notas = notas.trim();

      const res = await fetch("/api/ordenes-compra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Error al crear la orden");
      }
      resetForm();
      onOrderCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear la orden");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) { resetForm(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva Orden de Compra</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {error && (
            <div className="rounded bg-red-50 border border-red-200 p-2 text-xs text-red-600">
              {error}
            </div>
          )}

          <div className="space-y-2 max-h-32 overflow-y-auto">
            {items.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-2">Sin productos aún</p>
            )}
            {items.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between bg-gray-50 p-2 rounded text-sm">
                <span>{item.nombre}{item.esNuevo && <span className="text-xs text-blue-500 ml-1">(nuevo)</span>}</span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">{item.cantidad}x</span>
                  <button onClick={() => removeOrderItem(idx)} className="text-xs text-red-400 hover:text-red-600">✕</button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs font-medium">
            <button
              type="button"
              onClick={() => setAddingItem(f => ({ ...f, esNuevo: false, nombre_nuevo: "", producto_id: "" }))}
              className={`px-3 py-1 rounded ${!addingItem.esNuevo ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600"}`}
            >
              Existente
            </button>
            <button
              type="button"
              onClick={() => setAddingItem(f => ({ ...f, esNuevo: true, producto_id: "" }))}
              className={`px-3 py-1 rounded ${addingItem.esNuevo ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}
            >
              + Nuevo producto
            </button>
          </div>

          <div className="flex gap-2">
            {!addingItem.esNuevo ? (
              <select
                value={addingItem.producto_id}
                onChange={(e) => setAddingItem(f => ({ ...f, producto_id: e.target.value }))}
                className="flex-1 rounded border border-input px-2 py-1.5 text-sm h-8"
              >
                <option value="">Producto...</option>
                {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            ) : (
              <Input
                placeholder="Nombre del producto nuevo"
                className="flex-1 h-8 text-sm"
                value={addingItem.nombre_nuevo}
                onChange={e => setAddingItem(f => ({ ...f, nombre_nuevo: e.target.value }))}
              />
            )}
            <Input
              type="number"
              placeholder="Cant"
              className="w-16 h-8 text-sm"
              value={addingItem.cantidad}
              onChange={(e) => setAddingItem(f => ({ ...f, cantidad: e.target.value }))}
            />
            <Button
              size="sm"
              disabled={(!addingItem.producto_id && !addingItem.nombre_nuevo.trim()) || !addingItem.cantidad}
              onClick={addOrderItem}
              className="h-8"
            >
              Agregar
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Fecha estimada de entrega</label>
              <Input
                type="date"
                className="h-8 text-sm"
                value={fechaEstimada}
                onChange={(e) => setFechaEstimada(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Notas</label>
            <textarea
              className="w-full rounded border border-input px-2 py-1.5 text-sm resize-none h-16"
              placeholder="Notas opcionales para la orden..."
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              maxLength={255}
            />
            <div className="flex justify-between text-xs mt-1">
              <span className={notasError ? "text-red-500" : "text-transparent"}>
                {notasError ? "Las notas deben tener al menos 5 caracteres" : "-"}
              </span>
              <span className="text-gray-400">{notas.length}/255</span>
            </div>
          </div>

          <p className="text-xs text-gray-500">El precio se ingresará al recibir la orden.</p>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => { resetForm(); onClose(); }}>
            Cancelar
          </Button>
          <Button size="sm" disabled={items.length === 0 || isPending || notasError} onClick={handleCreate}>
            {isPending ? "Creando..." : "Crear OC"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
