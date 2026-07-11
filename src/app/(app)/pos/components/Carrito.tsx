"use client";

import { useState } from "react";
import {
  usePOSStore,
  calcularSubtotalCarrito,
  calcularSubtotalNetoCarrito,
  calcularImpuestoCarrito,
  calcularTotalCarrito,
} from "@/stores/pos";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Carrito() {
  const { items, removeItem, updateQuantity, descuento, clearCart } = usePOSStore();
  const [confirmClear, setConfirmClear] = useState(false);

  // Calculados con items/descuento del MISMO render (ver invariante en stores/pos.ts) —
  // regresión: usar los getters subtotal()/impuesto()/total() del store aquí producía
  // "Cobrar $0" tras rehidratar un carrito persistido en localStorage.
  const cartSubtotal = calcularSubtotalCarrito(items);
  const cartSubtotalNeto = calcularSubtotalNetoCarrito(items);
  const cartDescuentoMonto = (cartSubtotal * descuento) / 100;
  const cartImpuesto = calcularImpuestoCarrito(items, descuento);
  const cartTotal = calcularTotalCarrito(items, descuento);

  const isVencido = (item: typeof items[0]) => {
    if (!item.fecha_vencimiento) return false;
    const hoy = new Date().toISOString().split("T")[0];
    return item.fecha_vencimiento < hoy;
  };

  const getPrecioDisplay = (item: typeof items[0]) => {
    return item.en_oferta && item.precio_oferta ? item.precio_oferta : item.precio;
  };

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
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Carrito ({items.length} {items.length === 1 ? "item" : "items"})
          </CardTitle>
          {!confirmClear ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmClear(true)}
              className="text-xs text-red-500 border-red-300 hover:bg-red-50 hover:text-red-700 h-7 px-2"
            >
              Limpiar carro
            </Button>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">¿Seguro?</span>
              <Button
                size="sm"
                onClick={() => { clearCart(); setConfirmClear(false); }}
                className="text-xs bg-red-600 hover:bg-red-700 text-white h-7 px-2"
              >
                Sí
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmClear(false)}
                className="text-xs h-7 px-2"
              >
                No
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-2 overflow-y-auto max-h-80 p-3">
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex items-center justify-between rounded p-2 gap-2 ${
              isVencido(item) ? "bg-red-50 border border-red-200" : "bg-gray-50"
            }`}
          >
            <div className="flex-1 min-w-0">
              {item.es_granel ? (
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{item.nombre}</p>
                  <span className="text-xs font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded whitespace-nowrap">
                    Granel
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{item.nombre}</p>
                  {isVencido(item) && (
                    <span className="text-xs font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded whitespace-nowrap">
                      ✕ Vencido
                    </span>
                  )}
                </div>
              )}
              <div className="text-xs text-gray-500 mt-0.5">
                {item.es_granel
                  ? `${item.gramos}g · ${item.precio.toLocaleString("es-CL")}/kg`
                  : item.en_oferta && item.precio_oferta ? (
                    <>
                      <span className="line-through">${item.precio.toLocaleString("es-CL")}</span>
                      {" → "}
                      <span className="font-bold text-green-600">
                        ${getPrecioDisplay(item).toLocaleString("es-CL")} c/u
                      </span>
                    </>
                  ) : (
                    <span>${item.precio.toLocaleString("es-CL")} c/u</span>
                  )}
              </div>
            </div>

            {/* Botones: granel solo muestra eliminar */}
            <div className="flex items-center gap-1 shrink-0">
              {!item.es_granel && (
                <>
                  <button
                    onClick={() => updateQuantity(item.id, item.cantidad - 1)}
                    className="w-6 h-6 text-xs flex items-center justify-center hover:bg-gray-200 rounded"
                  >
                    −
                  </button>
                  <span className="text-xs w-5 text-center font-medium">{item.cantidad}</span>
                  <button
                    onClick={() => updateQuantity(item.id, item.cantidad + 1)}
                    disabled={item.stock !== undefined && item.cantidad >= item.stock}
                    title={item.stock !== undefined && item.cantidad >= item.stock ? `Stock máximo: ${item.stock}` : undefined}
                    className={`w-6 h-6 text-xs flex items-center justify-center rounded ${
                      item.stock !== undefined && item.cantidad >= item.stock
                        ? "opacity-30 cursor-not-allowed"
                        : "hover:bg-gray-200"
                    }`}
                  >
                    +
                  </button>
                </>
              )}
              {item.es_granel && (
                <span className="text-xs font-medium text-blue-700 mr-1">
                  ${item.subtotal.toLocaleString("es-CL")}
                </span>
              )}
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
          <span>${cartSubtotalNeto.toLocaleString("es-CL")}</span>
        </div>
        {descuento > 0 && (
          <div className="flex justify-between text-green-600">
            <span>Descuento ({descuento}%)</span>
            <span>−${cartDescuentoMonto.toLocaleString("es-CL")}</span>
          </div>
        )}
        <div className="flex justify-between text-gray-600">
          <span>IVA (19%)</span>
          <span>${cartImpuesto.toLocaleString("es-CL")}</span>
        </div>
        <div className="flex justify-between font-bold text-base border-t pt-2 mt-1">
          <span>Total</span>
          <span className="text-green-700">${cartTotal.toLocaleString("es-CL")}</span>
        </div>
      </div>
    </Card>
  );
}
