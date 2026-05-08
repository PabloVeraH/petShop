"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { Producto } from "@/types";
import { usePOSStore } from "@/stores/pos";
import { getProductos } from "../api";
import BarcodeScanner from "./BarcodeScanner";

export default function SearchProductos() {
  const [search, setSearch] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const { addItem, mascotaId } = usePOSStore();
  const queryClient = useQueryClient();

  // Timestamp of the first character typed — used to detect pistola vs teclado
  const inputStartRef = useRef<number | null>(null);

  const { data: productos, isLoading, isError } = useQuery({
    queryKey: ["productos", search],
    queryFn: () => getProductos(search),
    staleTime: 30_000,
  });

  function addProductoToCart(prod: Producto) {
    const precioFinal = prod.en_oferta && prod.precio_oferta ? prod.precio_oferta : prod.precio;
    if (precioFinal === null || precioFinal === undefined) return;
    addItem({
      producto_id: prod.id,
      nombre: prod.nombre,
      precio: precioFinal,
      cantidad: 1,
      subtotal: precioFinal,
      mascota_id: mascotaId,
      fecha_vencimiento: prod.fecha_vencimiento,
      precio_oferta: prod.precio_oferta,
      en_oferta: prod.en_oferta,
    });
  }

  async function handleBarcodeEnter(barcode: string) {
    setScanError(null);
    // Fetch with barcode as search — API searches codigo_barra exact match
    const results: Producto[] = await queryClient.fetchQuery({
      queryKey: ["productos", barcode],
      queryFn: () => getProductos(barcode),
      staleTime: 10_000,
    });

    const exact = results.find(
      (p) => p.codigo_barra === barcode || p.sku === barcode
    );

    if (exact) {
      addProductoToCart(exact);
      setSearch("");
      inputStartRef.current = null;
    } else {
      setScanError(`Código "${barcode}" no encontrado`);
      setTimeout(() => setScanError(null), 3000);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      const elapsed = inputStartRef.current ? Date.now() - inputStartRef.current : Infinity;
      const value = search.trim();
      if (!value) return;

      // Pistola: fills the input very fast (< 150ms for the whole string)
      // or the input looks like a barcode (all digits or short alphanum, no spaces)
      const looksLikeBarcode = /^[A-Za-z0-9\-]{4,100}$/.test(value) && !value.includes(" ");
      const isScanner = elapsed < 150 || looksLikeBarcode;

      if (isScanner) {
        e.preventDefault();
        handleBarcodeEnter(value);
      }
      inputStartRef.current = null;
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (inputStartRef.current === null) {
      inputStartRef.current = Date.now();
    }
    setSearch(e.target.value);
    setScanError(null);
  }

  const getVencimientoStatus = (prod: Producto | undefined) => {
    if (!prod?.fecha_vencimiento) return null;
    const hoy = new Date().toISOString().split("T")[0];
    if (prod.fecha_vencimiento < hoy) return "vencido";
    const diasRestantes = Math.ceil(
      (new Date(prod.fecha_vencimiento).getTime() - new Date(hoy).getTime()) / 86400000
    );
    if (diasRestantes <= (prod.dias_alerta_expira ?? 30)) return "proximo";
    return null;
  };

  return (
    <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
      <div className="flex gap-2">
        <Input
          placeholder="Buscar por nombre, SKU o código de barra..."
          value={search}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          autoFocus
          className="flex-1"
        />
        <button
          onClick={() => setShowScanner(true)}
          title="Escanear código de barras con cámara"
          className="px-3 rounded-md border border-input hover:bg-gray-50 text-gray-500 text-lg"
        >
          ▦
        </button>
      </div>

      {scanError && (
        <p className="text-sm text-red-500 font-medium">{scanError}</p>
      )}

      {isLoading && (
        <p className="text-sm text-gray-400 py-4 text-center">Cargando...</p>
      )}

      {isError && (
        <p className="text-sm text-red-500 py-4 text-center">Error al cargar productos. Intenta de nuevo.</p>
      )}

      {!isLoading && !isError && productos?.length === 0 && search.trim() && (
        <p className="text-sm text-gray-400 py-4 text-center">Sin resultados</p>
      )}

      {showScanner && (
        <BarcodeScanner
          onDetected={(code) => {
            setShowScanner(false);
            handleBarcodeEnter(code);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 max-h-[60vh] lg:max-h-96 overflow-y-auto">
        {productos?.map((prod) => {
          const vencStatus = getVencimientoStatus(prod);
          const precioFinal = prod.en_oferta && prod.precio_oferta ? prod.precio_oferta : prod.precio;
          const sinPrecio = precioFinal === null || precioFinal === undefined;

          return (
            <button
              key={prod.id}
              onClick={() => addProductoToCart(prod)}
              disabled={sinPrecio}
              className={`text-left rounded border p-4 transition-colors min-h-[72px] ${
                sinPrecio
                  ? "border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed"
                  : vencStatus === "vencido"
                  ? "bg-red-50 border-red-200 hover:bg-red-100 active:bg-red-100"
                  : vencStatus === "proximo"
                  ? "bg-amber-50 border-amber-200 hover:bg-amber-100 active:bg-amber-100"
                  : "border-gray-200 hover:bg-green-50 hover:border-green-200 active:bg-green-100"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-sm leading-tight flex-1">{prod.nombre}</p>
                {sinPrecio && (
                  <span className="text-xs font-bold text-gray-500 bg-gray-200 px-2 py-0.5 rounded">
                    Sin precio
                  </span>
                )}
                {!sinPrecio && vencStatus === "vencido" && (
                  <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded">
                    ✕ Vencido
                  </span>
                )}
                {!sinPrecio && vencStatus === "proximo" && (
                  <span className="text-xs font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded">
                    ⚠ Próximo
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">SKU: {prod.sku}</p>
              <div className="flex items-center justify-between mt-2">
                <div className="flex flex-col">
                  {sinPrecio ? (
                    <span className="text-sm text-gray-400">—</span>
                  ) : prod.en_oferta && prod.precio_oferta ? (
                    <>
                      <span className="text-xs text-gray-500 line-through">
                        ${(prod.precio ?? 0).toLocaleString("es-CL")}
                      </span>
                      <span className="text-sm font-bold text-green-700">
                        ${precioFinal!.toLocaleString("es-CL")}
                      </span>
                    </>
                  ) : (
                    <span className="text-sm font-bold text-green-700">
                      ${precioFinal!.toLocaleString("es-CL")}
                    </span>
                  )}
                </div>
                <Badge variant={prod.stock <= prod.stock_minimo ? "destructive" : "secondary"}>
                  Stock: {prod.stock}
                </Badge>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
