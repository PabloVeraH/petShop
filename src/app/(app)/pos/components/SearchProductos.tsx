"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ImageOff } from "lucide-react";
import type { Producto } from "@/types";
import { usePOSStore } from "@/stores/pos";
import { getProductos, accionSaco } from "../api";
import { fetchJson } from "@/lib/api-client";
import BarcodeScanner from "./BarcodeScanner";
import { Skeleton } from "@/components/ui/skeleton";
import { estadoSacos, formatoSacos, textoResiduoSacos, etiquetaSaco, gramosDesdeValor } from "@/lib/granel";
import { useReintentoTrasLimite } from "@/hooks/useReintentoTrasLimite";

export default function SearchProductos() {
  const [search, setSearch] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [granelProductoId, setGranelProductoId] = useState<string | null>(null);
  const [granelInput, setGranelInput] = useState<string>("");
  const [stockWarning, setStockWarning] = useState<string | null>(null);
  // Granel: confirmación forzada de apertura (G1), merma (G6) y errores del saco.
  const [confirmarApertura, setConfirmarApertura] = useState<{ productoId: string; gramos: number } | null>(null);
  const [mermaProductoId, setMermaProductoId] = useState<string | null>(null);
  const [mermaMotivo, setMermaMotivo] = useState("");
  const [sacoError, setSacoError] = useState<{ productoId: string; mensaje: string } | null>(null);
  const [sacoPendiente, setSacoPendiente] = useState(false);
  // Varios sacos abiertos (migración 096): saco elegido para la venta a granel
  // y para la merma, y confirmación (con nombre opcional) de abrir otro saco.
  const [sacoGranelId, setSacoGranelId] = useState("");
  const [mermaSacoId, setMermaSacoId] = useState("");
  const [otroSacoProductoId, setOtroSacoProductoId] = useState<string | null>(null);
  const [nombreNuevoSaco, setNombreNuevoSaco] = useState("");
  // Miniaturas con error de carga (URL rota en R2) — cae al placeholder en vez
  // de mostrar el ícono de imagen quebrada del navegador.
  const [imgErrorIds, setImgErrorIds] = useState<Set<string>>(new Set());
  const stockWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { addItem, mascotaId, items } = usePOSStore();
  const queryClient = useQueryClient();

  // Timestamp of the first character typed — used to detect pistola vs teclado
  const inputStartRef = useRef<number | null>(null);

  const { data: productos, isLoading, isError, error: productosError, refetch } = useQuery({
    queryKey: ["productos", search],
    queryFn: () => getProductos(search),
    staleTime: 30_000,
  });
  // 429: no se reintenta de inmediato (reintentarQuery); se vuelve a pedir al
  // vencer el Retry-After.
  useReintentoTrasLimite(productosError, refetch);

  // "Vender productos vencidos" (migración 095, /settings). Misma query que la
  // página del POS y el layout: comparten caché. Mientras carga, se asume
  // desactivado (lo más restrictivo); la BD vuelve a decidir al cobrar.
  const { data: tienda } = useQuery<{ vender_vencidos?: boolean; venta_granel_por?: "gramos" | "valor" }>({
    queryKey: ["store-name"],
    queryFn: () => fetchJson("/api/tienda/nombre"),
    staleTime: 5 * 60 * 1000,
  });
  const venderVencidos = tienda?.vender_vencidos === true;
  // Granel por valor (migración 099): el cajero escribe el monto y se calculan
  // los gramos. El servidor vuelve a decidir con la configuración de la tienda.
  const granelPorValor = tienda?.venta_granel_por === "valor";

  // Unidades vendibles por unidad: para granel, solo los sacos cerrados (el
  // abierto se vende por gramos). La BD aplica la misma regla (I5, 077).
  // Las unidades en lotes vencidos solo cuentan si la tienda permite venderlas
  // (crear_venta_tx, 095).
  function unidadesVendibles(prod: Producto): number {
    if ((prod.precio_venta_kg ?? 0) > 0) return estadoSacos(prod).cerrados;
    return venderVencidos ? prod.stock : Math.max(0, prod.stock - (prod.stock_vencido ?? 0));
  }

  function mostrarAviso(mensaje: string) {
    setStockWarning(mensaje);
    if (stockWarningTimerRef.current) clearTimeout(stockWarningTimerRef.current);
    stockWarningTimerRef.current = setTimeout(() => {
      setStockWarning(null);
      stockWarningTimerRef.current = null;
    }, 3000);
  }

  function addProductoToCart(prod: Producto) {
    const precioFinal = prod.en_oferta && prod.precio_oferta ? prod.precio_oferta : prod.precio;
    if (!precioFinal) return;

    // Guard sobrestock: verificar cantidad ya en carrito vs stock disponible
    const esGranel = (prod.precio_venta_kg ?? 0) > 0;
    const vencidas = esGranel ? 0 : prod.stock_vencido ?? 0;
    const maxUnidades = unidadesVendibles(prod);
    const inCartItem = items.find((i) => i.producto_id === prod.id && !i.es_granel);
    const inCartQty = inCartItem?.cantidad ?? 0;
    if (inCartQty >= maxUnidades) {
      mostrarAviso(vencidas > 0 && !venderVencidos
        ? `${prod.nombre}: ${vencidas} en lote vencido. La tienda no permite vender productos vencidos`
        : `Stock máximo alcanzado: ${maxUnidades} unidad${maxUnidades !== 1 ? "es" : ""} disponible${maxUnidades !== 1 ? "s" : ""}`);
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
      stock: maxUnidades,
    });

    // Avisos que NO bloquean la venta. Granel tiene su propio estado de sacos.
    if (esGranel) return;
    const cantidad = inCartQty + 1;
    const avisos: string[] = [];
    if (venderVencidos && cantidad > prod.stock - vencidas) {
      avisos.push(`${prod.nombre}: se venderá de un lote vencido`);
    }
    const quedan = prod.stock - cantidad;
    if (cantidad >= maxUnidades) {
      avisos.push(`Última unidad disponible de ${prod.nombre}`);
    } else if (quedan <= prod.stock_minimo) {
      avisos.push(`Stock bajo: quedarán ${quedan} de ${prod.nombre} (mínimo ${prod.stock_minimo})`);
    }
    if (avisos.length > 0) mostrarAviso(avisos.join(" · "));
  }

  // Sacos abiertos con gramos (096). Con 2 o más, el cajero elige el saco.
  function sacosConGramos(prod: Producto) {
    return (prod.sacos_abiertos ?? []).filter((s) => s.gramos_restantes > 0);
  }

  // Gramos de lo escrito en el campo (gramos, o valor convertido). 0 = inválido.
  function gramosDelCampo(prod: Producto): number {
    const n = parseInt(granelInput, 10);
    if (!prod.precio_venta_kg || isNaN(n) || n <= 0) return 0;
    return granelPorValor ? gramosDesdeValor(n, prod.precio_venta_kg) : n;
  }

  // G1: si los gramos pedidos (más los granel de este producto ya en el
  // carrito, que la venta consume antes) superan el saco abierto, el cajero
  // debe confirmar la apertura de un saco nuevo. La BD vuelve a verificarlo
  // y responde 409 si la línea no trae la confirmación. Con varios sacos
  // abiertos (096) la cuenta es contra el saco elegido.
  function addGranelToCart(prod: Producto, confirmado = false) {
    const gramos = gramosDelCampo(prod);
    if (!prod.precio_venta_kg || gramos < 1) return;
    const monto = granelPorValor ? parseInt(granelInput, 10) : undefined;

    const { peso, gramosAbiertos, cerrados } = estadoSacos(prod);
    const abiertos = sacosConGramos(prod);
    const saco = abiertos.length > 1 ? abiertos.find((s) => s.id === sacoGranelId) : undefined;
    if (abiertos.length > 1 && !saco) {
      setSacoError({ productoId: prod.id, mensaje: "Hay varios sacos abiertos: elige de cuál vendes" });
      return;
    }
    const lineasGranel = items.filter((i) => i.producto_id === prod.id && i.es_granel);
    const gramosEnCarrito = lineasGranel.reduce((sum, i) => sum + (i.gramos ?? 0), 0);
    const sacosEnCarrito = items.find((i) => i.producto_id === prod.id && !i.es_granel)?.cantidad ?? 0;

    if (gramosEnCarrito + gramos > gramosAbiertos + Math.max(0, cerrados - sacosEnCarrito) * peso) {
      setSacoError({ productoId: prod.id, mensaje: "Stock insuficiente para esa cantidad a granel" });
      return;
    }
    const necesitaAbrir = saco
      ? lineasGranel.filter((i) => i.saco_id === saco.id).reduce((s, i) => s + (i.gramos ?? 0), 0) + gramos > saco.gramos_restantes
      : gramosEnCarrito + gramos > gramosAbiertos;
    if (necesitaAbrir && !confirmado) {
      setConfirmarApertura({ productoId: prod.id, gramos });
      return;
    }

    const kg = gramos / 1000;
    // Por valor se cobra justo lo que pidió el cliente.
    const subtotal = monto ?? Math.round(kg * prod.precio_venta_kg);

    addItem({
      producto_id: prod.id,
      nombre: prod.nombre,
      precio: prod.precio_venta_kg,   // precio por kg = "precio unitario"
      cantidad: kg,                    // kg vendidos (ej: 0.5 para 500g)
      subtotal,
      mascota_id: mascotaId,
      es_granel: true,
      gramos,                          // fuente de verdad del descuento de stock
      ...(monto !== undefined ? { monto } : {}),
      ...(necesitaAbrir ? { abrir_saco: true } : {}),
      ...(saco ? { saco_id: saco.id } : {}),
    });

    setConfirmarApertura(null);
    setSacoError(null);
    setGranelProductoId(null);
    setGranelInput("");
  }

  async function ejecutarAccionSaco(prod: Producto, body: Parameters<typeof accionSaco>[1]) {
    setSacoPendiente(true);
    setSacoError(null);
    try {
      await accionSaco(prod.id, body);
      setMermaProductoId(null);
      setMermaMotivo("");
      setMermaSacoId("");
      setOtroSacoProductoId(null);
      setNombreNuevoSaco("");
      await queryClient.invalidateQueries({ queryKey: ["productos"] });
    } catch (e) {
      setSacoError({ productoId: prod.id, mensaje: e instanceof Error ? e.message : "Error en la acción del saco" });
    } finally {
      setSacoPendiente(false);
    }
  }

  // D18: "Abrí un saco nuevo". Con gramos en un saco abierto (096) se pide
  // confirmación y un nombre opcional (ej. "Mesón 2"): quedan varios sacos
  // abiertos, cada apertura descuenta un saco cerrado. La BD exige la misma
  // confirmación (permitir_otro).
  function abrirSacoManual(prod: Producto) {
    const { gramosAbiertos } = estadoSacos(prod);
    if (gramosAbiertos > 0) {
      setSacoError(null);
      setOtroSacoProductoId(prod.id);
      setNombreNuevoSaco("");
      return;
    }
    ejecutarAccionSaco(prod, { accion: "abrir" });
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
    // Fetch with barcode as search — API searches codigo_barra exact match.
    // Un error (429, 5xx, red) se muestra: antes quedaba como promesa
    // rechazada sin manejar y el escaneo fallaba en silencio.
    let results: Producto[];
    try {
      results = await queryClient.fetchQuery({
        queryKey: ["productos", barcode],
        queryFn: () => getProductos(barcode),
        staleTime: 10_000,
      });
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Error al buscar el producto");
      return;
    }

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
        <p role="alert" className="text-sm text-red-500 py-4 text-center">
          Error al cargar productos. {productosError?.message ?? "Intenta de nuevo."}
        </p>
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
          const sinStock = !tieneGranel && inCartQty >= unidadesVendibles(prod);
          const vencidas = tieneGranel ? 0 : prod.stock_vencido ?? 0;
          const sacos = tieneGranel ? estadoSacos(prod) : null;
          const errorSaco = sacoError?.productoId === prod.id ? sacoError.mensaje : null;
          const pidiendoApertura = confirmarApertura?.productoId === prod.id;
          const enMerma = mermaProductoId === prod.id;
          const abiertos = tieneGranel ? sacosConGramos(prod) : [];
          const varios = abiertos.length > 1;
          const pidiendoOtroSaco = otroSacoProductoId === prod.id;
          // Sin la lista (respuesta anterior a la 096) pero con gramos: 1 saco.
          const cantidadAbiertos = abiertos.length || ((sacos?.gramosAbiertos ?? 0) > 0 ? 1 : 0);
          const sacoElegido = varios ? abiertos.find((s) => s.id === sacoGranelId) : undefined;

          return (
            <div key={prod.id} className="relative min-w-0 rounded border bg-white shadow-sm hover:shadow-md transition-shadow">
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
                <div className="flex gap-3">
                  {prod.imagen_url && !imgErrorIds.has(prod.id) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={prod.imagen_url}
                      alt={prod.nombre}
                      className="w-14 h-14 rounded object-cover border border-gray-100 shrink-0"
                      onError={() =>
                        setImgErrorIds((prev) => new Set(prev).add(prod.id))
                      }
                    />
                  ) : (
                    <div className="w-14 h-14 rounded border border-gray-100 bg-gray-50 flex items-center justify-center shrink-0">
                      <ImageOff className="w-5 h-5 text-gray-300" aria-hidden="true" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm leading-tight flex-1">{prod.nombre}</p>
                      {sinPrecio && (
                        <span className="text-xs font-bold text-gray-500 bg-gray-200 px-2 py-0.5 rounded">
                          Sin precio
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">SKU: {prod.sku}</p>
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <div className="flex flex-col min-w-0">
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
                        {sacos ? formatoSacos(sacos.cerrados, sacos.gramosAbiertos) : `Stock: ${prod.stock}`}
                      </Badge>
                    </div>
                    {vencidas > 0 && (
                      <span className="block mt-1 text-[11px] text-red-600 text-right">
                        {vencidas} en lote vencido · {venderVencidos ? "se vende con aviso" : "no se puede vender"}
                      </span>
                    )}
                    {sacos && sacos.residuo > 0 && (
                      <span
                        className="block mt-1 text-[11px] text-amber-700 text-right break-words"
                        title="Stock con decimales sin saco abierto: corrígelo con Conteo físico"
                      >
                        ({textoResiduoSacos(sacos.residuo)})
                      </span>
                    )}
                    {tieneGranel && (
                      <span className="text-xs text-blue-600 mt-2 block">
                        Granel: ${prod.precio_venta_kg!.toLocaleString("es-CL")}/kg
                        {" · "}
                        {varios
                          ? `${abiertos.length} sacos abiertos: ${abiertos.map(etiquetaSaco).join(" | ")}`
                          : sacos && sacos.gramosAbiertos > 0
                          ? `saco abierto: ${sacos.gramosAbiertos.toLocaleString("es-CL")} g`
                          : "sin saco abierto"}
                      </span>
                    )}
                  </div>
                </div>
              </button>

              {/* Toggle + input granel */}
              {tieneGranel && (
                <div className="border-t border-blue-100 px-3 py-2 bg-blue-50 space-y-2">
                  {pidiendoApertura ? (
                    <div role="alertdialog" aria-label="Confirmar apertura de saco" className="space-y-2">
                      <p className="text-xs text-amber-800">
                        El saco abierto no alcanza para {confirmarApertura!.gramos} g
                        {sacoElegido ? ` (quedan ${sacoElegido.gramos_restantes} g)` : sacos ? ` (quedan ${sacos.gramosAbiertos} g)` : ""}. ¿Abrir un saco nuevo?
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => addGranelToCart(prod, true)}
                          className="text-xs bg-amber-600 text-white rounded px-2 py-1"
                        >
                          Abrir saco y agregar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmarApertura(null)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : pidiendoOtroSaco ? (
                    <div role="alertdialog" aria-label="Confirmar otro saco abierto" className="space-y-2">
                      <p className="text-xs text-amber-800">
                        Ya {cantidadAbiertos === 1 ? "hay 1 saco abierto" : `hay ${cantidadAbiertos} sacos abiertos`} con{" "}
                        {(sacos?.gramosAbiertos ?? 0).toLocaleString("es-CL")} g. ¿Abrir otro? Se descuenta un saco
                        cerrado y quedarán {cantidadAbiertos + 1} abiertos: al vender a granel habrá que elegir de cuál.
                      </p>
                      <input
                        type="text"
                        aria-label="Nombre del saco nuevo"
                        placeholder="Nombre (opcional), ej. Mesón 2"
                        maxLength={60}
                        value={nombreNuevoSaco}
                        onChange={(e) => setNombreNuevoSaco(e.target.value)}
                        className="w-full text-sm border border-amber-300 rounded px-2 py-1"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={sacoPendiente}
                          onClick={() => ejecutarAccionSaco(prod, {
                            accion: "abrir",
                            permitir_otro: true,
                            ...(nombreNuevoSaco.trim() ? { nota: nombreNuevoSaco.trim() } : {}),
                          })}
                          className="text-xs bg-amber-600 text-white rounded px-2 py-1 disabled:opacity-50"
                        >
                          Abrir otro saco
                        </button>
                        <button
                          type="button"
                          onClick={() => { setOtroSacoProductoId(null); setNombreNuevoSaco(""); }}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : !isGranelActivo ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setGranelProductoId(prod.id);
                          setGranelInput("");
                          setSacoGranelId("");
                          setSacoError(null);
                        }}
                        className="text-xs text-blue-600 hover:underline font-medium"
                      >
                        Vender a granel
                      </button>
                      <button
                        type="button"
                        disabled={sacoPendiente}
                        onClick={(e) => {
                          e.stopPropagation();
                          abrirSacoManual(prod);
                        }}
                        className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                      >
                        Abrí un saco nuevo
                      </button>
                      {sacos && sacos.gramosAbiertos > 0 && !enMerma && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMermaProductoId(prod.id);
                            setMermaMotivo("");
                            setMermaSacoId("");
                          }}
                          className="text-xs text-gray-600 hover:underline"
                        >
                          Registrar merma
                        </button>
                      )}
                    </div>
                  ) : (
                    // flex-wrap: con el total "= $X" el botón Cancelar se salía de la tarjeta.
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {varios && (
                        <select
                          aria-label="Saco del que se vende"
                          value={sacoGranelId}
                          onChange={(e) => setSacoGranelId(e.target.value)}
                          className="w-full text-sm border border-blue-300 rounded px-2 py-1 bg-white"
                        >
                          <option value="">Elige el saco…</option>
                          {abiertos.map((s, i) => (
                            <option key={s.id} value={s.id}>{etiquetaSaco(s, i)}</option>
                          ))}
                        </select>
                      )}
                      {granelPorValor ? (
                        // Texto, no number: "2.000" en un campo numérico vale 2.
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label="Valor en pesos a vender"
                          placeholder="Valor $"
                          value={granelInput}
                          maxLength={10}
                          onChange={(e) => setGranelInput(e.target.value.replace(/\D/g, "").slice(0, 8))}
                          onKeyDown={(e) => e.key === "Enter" && addGranelToCart(prod)}
                          autoFocus
                          className="w-24 text-sm border border-blue-300 rounded px-2 py-1"
                        />
                      ) : (
                        <input
                          type="number"
                          min={1}
                          placeholder="Gramos"
                          value={granelInput}
                          onChange={(e) => setGranelInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && addGranelToCart(prod)}
                          autoFocus
                          className="w-24 text-sm border border-blue-300 rounded px-2 py-1"
                        />
                      )}
                      {granelInput && Number(granelInput) > 0 && (
                        <span className="text-xs text-gray-600">
                          {!granelPorValor
                            ? `= $${Math.round((Number(granelInput) / 1000) * prod.precio_venta_kg!).toLocaleString("es-CL")}`
                            : gramosDelCampo(prod) >= 1
                            ? `= ${gramosDelCampo(prod).toLocaleString("es-CL")} g`
                            : "No alcanza para 1 g"}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => addGranelToCart(prod)}
                        disabled={gramosDelCampo(prod) < 1 || (varios && !sacoElegido)}
                        className="text-xs bg-blue-600 text-white rounded px-2 py-1 disabled:opacity-50"
                      >
                        Agregar
                      </button>
                      <button
                        type="button"
                        onClick={() => { setGranelProductoId(null); setGranelInput(""); }}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}

                  {/* G6: merma del resto del saco abierto (guarda el usuario en la BD) */}
                  {enMerma && (
                    <div className="flex flex-wrap items-center gap-2">
                      {varios && (
                        <select
                          aria-label="Saco de la merma"
                          value={mermaSacoId}
                          onChange={(e) => setMermaSacoId(e.target.value)}
                          className="w-full text-sm border border-gray-300 rounded px-2 py-1 bg-white"
                        >
                          <option value="">Elige el saco…</option>
                          {abiertos.map((s, i) => (
                            <option key={s.id} value={s.id}>{etiquetaSaco(s, i)}</option>
                          ))}
                        </select>
                      )}
                      <input
                        type="text"
                        placeholder="Motivo de la merma"
                        aria-label="Motivo de la merma"
                        value={mermaMotivo}
                        onChange={(e) => setMermaMotivo(e.target.value)}
                        // Fila propia: con flex-1 + min-w-0 se encogía y cortaba el placeholder.
                        className="w-full text-sm border border-gray-300 rounded px-2 py-1"
                      />
                      <button
                        type="button"
                        disabled={sacoPendiente || mermaMotivo.trim().length < 5 || (varios && !mermaSacoId)}
                        onClick={() => ejecutarAccionSaco(prod, {
                          accion: "merma",
                          motivo: mermaMotivo.trim(),
                          ...(varios ? { saco_id: mermaSacoId } : {}),
                        })}
                        className="text-xs bg-gray-700 text-white rounded px-2 py-1 disabled:opacity-50"
                      >
                        Confirmar merma
                      </button>
                      <button
                        type="button"
                        onClick={() => { setMermaProductoId(null); setMermaMotivo(""); }}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}

                  {errorSaco && (
                    <p role="alert" className="text-xs text-red-600">{errorSaco}</p>
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