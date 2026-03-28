"use client";

import { usePOSStore } from "@/stores/pos";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Carrito() {
  const { items, removeItem, updateQuantity, subtotal, impuesto, total, descuento } =
    usePOSStore();

  if (items.length === 0) {
    return (
      <Card className="flex-1">
        <CardHeader>
          <CardTitle className="text-base">Carrito</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-400 text-center py-8">
            Agrega productos desde la búsqueda
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Carrito ({items.length} {items.length === 1 ? "item" : "items"})
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 space-y-2 overflow-y-auto max-h-80 p-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between rounded bg-gray-50 p-2 gap-2"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.nombre}</p>
              <p className="text-xs text-gray-500">
                ${item.precio.toLocaleString("es-CL")} c/u
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => updateQuantity(item.id, item.cantidad - 1)}
                className="w-6 h-6 text-xs flex items-center justify-center hover:bg-gray-200 rounded"
              >
                −
              </button>
              <span className="text-xs w-5 text-center font-medium">{item.cantidad}</span>
              <button
                onClick={() => updateQuantity(item.id, item.cantidad + 1)}
                className="w-6 h-6 text-xs flex items-center justify-center hover:bg-gray-200 rounded"
              >
                +
              </button>
              <button
                onClick={() => removeItem(item.id)}
                className="w-6 h-6 text-xs flex items-center justify-center hover:bg-red-100 text-red-500 rounded ml-1"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </CardContent>

      <div className="border-t p-3 space-y-1 text-sm">
        <div className="flex justify-between text-gray-600">
          <span>Subtotal</span>
          <span>${subtotal().toLocaleString("es-CL")}</span>
        </div>
        {descuento > 0 && (
          <div className="flex justify-between text-green-600">
            <span>Descuento ({descuento}%)</span>
            <span>−${((subtotal() * descuento) / 100).toLocaleString("es-CL")}</span>
          </div>
        )}
        <div className="flex justify-between text-gray-600">
          <span>IVA (19%)</span>
          <span>${impuesto().toLocaleString("es-CL")}</span>
        </div>
        <div className="flex justify-between font-bold text-base border-t pt-2 mt-1">
          <span>Total</span>
          <span className="text-green-700">${Math.round(total()).toLocaleString("es-CL")}</span>
        </div>
      </div>
    </Card>
  );
}
