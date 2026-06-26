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

interface EditItem {
  id: string | null;
  producto_id: string | null;
  nombre_nuevo: string;
  nombre: string;
  cantidad: string;
  esNuevo: boolean;
}

interface EditOrderItemsDialogProps {
  open: boolean;
  onClose: () => void;
  ordenId: string;
  productos: ProductoOpt[];
  existingItems: { id: string; cantidad_solicitada: number; nombre_nuevo: string | null; productos: { id: string; nombre: string } | null }[];
  onOrderEdited: () => void;
}

export default function EditOrderItemsDialog({ open, onClose, ordenId, productos, existingItems, onOrderEdited }: EditOrderItemsDialogProps) {
  const parseItems = (): EditItem[] =>
    existingItems.map(i => ({
      id: i.id,
      producto_id: i.productos?.id ?? null,
      nombre_nuevo: i.nombre_nuevo ?? "",
      nombre: i.productos?.nombre ?? i.nombre_nuevo ?? "Producto",
      cantidad: String(i.cantidad_solicitada),
      esNuevo: !i.productos && !!i.nombre_nuevo,
    }));

  const [items, setItems] = useState<EditItem[]>([]);
  const [addingItem, setAddingItem] = useState({ producto_id: "", nombre_nuevo: "", cantidad: "1", esNuevo: false });
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  const prevOpen = useRef(open);
  const initialized = useRef(false);

  useEffect(() => {
    if (open && !prevOpen.current) {
      initialized.current = false;
    }
    if (open && !initialized.current) {
      setItems(parseItems());
      setAddingItem({ producto_id: "", nombre_nuevo: "", cantidad: "1", esNuevo: false });
      setError("");
      initialized.current = true;
    }
    prevOpen.current = open;
  }, [open, existingItems]);

  const addOrderItem = () => {
    if (addingItem.esNuevo) {
      if (!addingItem.nombre_nuevo.trim()) return;
      setItems(prev => [...prev, {
        id: null,
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
        id: null,
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

  const handleSave = async () => {
    setError("");
    if (items.length === 0) {
      setError("Debe haber al menos un producto en la orden");
      return;
    }

    setIsPending(true);
    try {
      const payload = {
        action: "edit_items" as const,
        items: items.map(item => ({
          producto_id: item.producto_id ?? undefined,
          nombre_nuevo: item.esNuevo ? item.nombre_nuevo : undefined,
          cantidad_solicitada: Number(item.cantidad),
        })),
      };

      const res = await fetch(`/api/ordenes-compra/${ordenId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Error al editar la orden");
      }
      onOrderEdited();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al editar la orden");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Items de la OC</DialogTitle>
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

          <p className="text-xs text-gray-500">Los cambios reemplazarán todos los items de la orden.</p>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" disabled={items.length === 0 || isPending} onClick={handleSave}>
            {isPending ? "Guardando..." : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
