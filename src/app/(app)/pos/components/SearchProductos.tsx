"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { usePOSStore } from "@/stores/pos";
import { getProductos } from "../api";
import BarcodeScanner from "./BarcodeScanner";

export default function SearchProductos() {
  const [search, setSearch] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const { addItem, mascotaId } = usePOSStore();

  const { data: productos, isLoading, isError } = useQuery({
    queryKey: ["productos", search],
    queryFn: () => getProductos(search),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
      <div className="flex gap-2">
        <Input
          placeholder="Buscar por nombre o SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          className="flex-1"
        />
        <button
          onClick={() => setShowScanner(true)}
          title="Escanear código de barras"
          className="px-3 rounded-md border border-input hover:bg-gray-50 text-gray-500 text-lg"
        >
          ▦
        </button>
      </div>

      {isLoading && (
        <p className="text-sm text-gray-400 py-4 text-center">Cargando...</p>
      )}

      {isError && (
        <p className="text-sm text-red-500 py-4 text-center">Error al cargar productos. Intenta de nuevo.</p>
      )}

      {!isLoading && !isError && productos?.length === 0 && (
        <p className="text-sm text-gray-400 py-4 text-center">Sin resultados</p>
      )}

      {showScanner && (
        <BarcodeScanner
          onDetected={(code) => { setSearch(code); setShowScanner(false); }}
          onClose={() => setShowScanner(false)}
        />
      )}

      <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
        {productos?.map((prod) => (
          <button
            key={prod.id}
            onClick={() =>
              addItem({
                producto_id: prod.id,
                nombre: prod.nombre,
                precio: prod.precio,
                cantidad: 1,
                subtotal: prod.precio,
                mascota_id: mascotaId,
              })
            }
            className="text-left rounded border border-gray-200 p-3 hover:bg-green-50 hover:border-green-200 transition-colors"
          >
            <p className="font-medium text-sm leading-tight">{prod.nombre}</p>
            <p className="text-xs text-gray-500 mt-1">SKU: {prod.sku}</p>
            <div className="flex items-center justify-between mt-2">
              <span className="text-sm font-bold text-green-700">
                ${prod.precio.toLocaleString("es-CL")}
              </span>
              <Badge variant={prod.stock <= prod.stock_minimo ? "destructive" : "secondary"}>
                Stock: {prod.stock}
              </Badge>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
