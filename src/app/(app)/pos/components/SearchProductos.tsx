"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { Producto } from "@/types";
import { usePOSStore } from "@/stores/pos";
import { getProductos } from "../api";
import BarcodeScanner from "./BarcodeScanner";
import { Skeleton } from "@/components/ui/skeleton";

export default function SearchProductos() {
  const [search, setSearch] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [granelProductoId, setGranelProductoId] = useState<string | null>(null);
  const [gramosInput, setGramosInput] = useState<string>("");
  const [stockWarning, setStockWarning] = useState<string | null>(null);
  const stockWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { addItem, mascotaId, items } = usePOSStore();
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
    if (!precioFinal) return;

    // Guard sobrestock: verificar cantidad ya en carrito vs stock disponible
    const inCartItem = items.find((i) => i.producto_id === prod.id && !i.es_granel);
    const inCartQty = inCartItem?.cantidad ?? 0;
    if (inCartQty >= prod.stock) {
      setStockWarning(`Stock máximo alcanzado: ${prod.stock} unidad${prod.stock !== 1 ? "es" : ""} disponible${prod.stock !== 1 ? "s" : ""}`);
      if (stockWarningTimerRef.current) clearTimeout(stockWarningTimerRef.current);
      stockWarningTimerRef.current = setTimeout(() => {
        setStockWarning(null);
        stockWarningTimerRef.current = null;
      }, 3000);
      return;
    }

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
      stock: prod.stock,
    });
  }

  function addGranelToCart(prod: Producto) {
    const gramos = parseInt(gramosInput, 10);
    if (!prod.precio_venta_kg || gramos <= 0 || isNaN(gramos)) return;

    const kg = gramos / 1000;
    const subtotal = Math.round(kg * prod.precio_venta_kg);

    addItem({
      producto_id: prod.id,
      nombre: prod.nombre,
      precio: prod.precio_venta_kg,   // precio por kg = "precio unitario"
      cantidad: kg,                    // kg vendidos (ej: 0.5 para 500g)
      subtotal,
      mascota_id: mascotaId,
      es_granel: true,
      gramos,                          // para mostrar en recibo y carrito
    });

    setGranelProductoId(null);
    setGramosInput("");
  }

  const handleDetected = useCallback((code: string) => {
    setShowScanner(false);
    handleBarcodeEnter(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (stockWarningTimerRef.current) clearTimeout(stockWarningTimerRef.current);
      if (scanErrorTimerRef.current) clearTimeout(scanErrorTimerRef.current);
    };
  }, []);

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
      const precioFinal = exact.en_oferta && exact.precio_oferta ? exact.precio_oferta : exact.precio;
      if (!precioFinal) {
        setScanError(`"${exact.nombre}" no tiene precio — asígnalo en inventario`);
        if (scanErrorTimerRef.current) clearTimeout(scanErrorTimerRef.current);
        scanErrorTimerRef.current = setTimeout(() => {
          setScanError(null);
          scanErrorTimerRef.current = null;
        }, 4000);
      } else {
        addProductoToCart(exact);
        setSearch("");
        inputStartRef.current = null;
      }
    } else {
      setScanError(`Código "${barcode}" no encontrado`);
      if (scanErrorTimerRef.current) clearTimeout(scanErrorTimerRef.current);
      scanErrorTimerRef.current = setTimeout(() => {
        setScanError(null);
        scanErrorTimerRef.current = null;
      }, 3000);
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
    const diasRestantes = Math.ceil(
      (new Date(prod.fecha_vencimiento).getTime() - new Date().getTime()) / 86400000
    );
    if (diasRestantes < 0) return "vencido";
    if (diasRestantes <= (prod.dias_alerta_expira ?? 30)) return "proximo";
    return null;
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-white p-4 shadow-sm h-full">
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
      {stockWarning && (
        <p className="text-sm text-amber-600 font-medium">{stockWarning}</p>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded border bg-white shadow-sm p-4 space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
              <div className="flex justify-between items-center pt-1">
                <Skeleton className="h-5 w-1/4" />
                <Skeleton className="h-5 w-1/5" />
              </div>
            </div>
          ))}
        </div>
      )}

      {isError && (
        <p className="text-sm text-red-500 py-4 text-center">Error al cargar productos. Intenta de nuevo.</p>
      )}

      {!isLoading && !isError && productos?.length === 0 && search.trim() && (
        <p className="text-sm text-gray-400 py-4 text-center">Sin resultados</p>
      )}

      {showScanner && (
        <BarcodeScanner
          onDetected={handleDetected}
          onClose={() => setShowScanner(false)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 overflow-y-auto max-h-[60vh] lg:max-h-none flex-1 min-h-0">
        {productos?.map((prod) => {
          const tieneGranel = (prod.precio_venta_kg ?? 0) > 0;
          const isGranelActivo = granelProductoId === prod.id;
          const vencStatus = getVencimientoStatus(prod);
          const precioFinal = prod.en_oferta && prod.precio_oferta ? prod.precio_oferta : prod.precio;
          const sinPrecio = !precioFinal;
          const inCartQty = items.find((i) => i.producto_id === prod.id && !i.es_granel)?.cantidad ?? 0;
          const sinStock = !tieneGranel && inCartQty >= prod.stock;

          return (
            <div key={prod.id} className="relative rounded border bg-white shadow-sm hover:shadow-md transition-shadow">
              <button
                onClick={() => {
                  if (isGranelActivo) return; // si granel abierto, ignorar click en fondo
                  addProductoToCart(prod);
                }}
                disabled={sinPrecio || sinStock}
                className={`text-left w-full p-4 transition-colors ${
                  sinPrecio || sinStock
                    ? "opacity-60 cursor-not-allowed"
                    : vencStatus === "vencido"
                    ? "bg-red-50 hover:bg-red-100"
                    : vencStatus === "proximo"
                    ? "bg-amber-50 hover:bg-amber-100"
                    : "hover:bg-green-50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm leading-tight flex-1">{prod.nombre}</p>
                  {sinPrecio && (
                    <span className="text-xs font-bold text-gray-500 bg-gray-200 px-2 py-0.5 rounded">
                      Sin precio
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
                {tieneGranel && (
                  <span className="text-xs text-blue-600 mt-2 block">
                    Granel: ${prod.precio_venta_kg!.toLocaleString("es-CL")}/kg
                  </span>
                )}
              </button>

              {/* Toggle + input granel */}
              {tieneGranel && (
                <div className="border-t border-blue-100 px-3 py-2 bg-blue-50">
                  {!isGranelActivo ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setGranelProductoId(prod.id);
                        setGramosInput("");
                      }}
                      className="text-xs text-blue-600 hover:underline font-medium"
                    >
                      Vender a granel
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        placeholder="Gramos"
                        value={gramosInput}
                        onChange={(e) => setGramosInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addGranelToCart(prod)}
                        autoFocus
                        className="w-24 text-sm border border-blue-300 rounded px-2 py-1"
                      />
                      {gramosInput && Number(gramosInput) > 0 && (
                        <span className="text-xs text-gray-600">
                          = ${Math.round(
                            (Number(gramosInput) / 1000) * prod.precio_venta_kg!
                          ).toLocaleString("es-CL")}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => addGranelToCart(prod)}
                        disabled={!gramosInput || Number(gramosInput) <= 0}
                        className="text-xs bg-blue-600 text-white rounded px-2 py-1 disabled:opacity-50"
                      >
                        Agregar
                      </button>
                      <button
                        type="button"
                        onClick={() => { setGranelProductoId(null); setGramosInput(""); }}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}