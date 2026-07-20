"use client";

import { useState, useEffect, useRef } from "react";
import { usePOSStore } from "@/stores/pos";

interface Recomendacion {
  producto_id: string;
  nombre:      string;
  precio:      number;
  razon:       string;
  urgencia:    "alta" | "media" | "baja";
}

export default function RecomendacionesIA() {
  const { clienteId, mascotaId, items, addItem } = usePOSStore();
  const [loading, setLoading]           = useState(false);
  const [recs, setRecs]                 = useState<Recomendacion[]>([]);
  const [agregados, setAgregados]       = useState<Set<string>>(new Set());
  const [error, setError]               = useState<string | null>(null);
  const debounceRef                     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchControllerRef              = useRef<AbortController | null>(null);

  useEffect(() => {
    // Limpiar recs si se deselecciona el cliente
    if (!clienteId) {
      setRecs([]);
      setAgregados(new Set());
      setError(null);
      setLoading(false);
      return;
    }

    // Mostrar el estado "cargando" de inmediato (no recién tras el debounce)
    // para reservar el espacio del panel desde el momento en que se
    // selecciona el cliente — evita el layout shift que empujaba el botón
    // "Cobrar" cuando el panel aparecía recién al terminar el debounce.
    setLoading(true);
    setError(null);

    // Debounce 800ms para no disparar en selecciones rápidas
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      fetchControllerRef.current = new AbortController();
      const timeoutId = setTimeout(() => fetchControllerRef.current?.abort(), 8000);
      try {
        const res = await fetch("/api/ai/pos/recomendar", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          signal:  fetchControllerRef.current.signal,
          body: JSON.stringify({
            clienteId,
            mascotaId,
            itemsCarrito: items.map((i) => ({
              producto_id: i.producto_id,
              nombre:      i.nombre,
              categoria:   undefined,
            })),
          }),
        });
        clearTimeout(timeoutId);
        const ct = res.headers?.get("content-type") ?? "";
        if (!res.ok || !ct.includes("application/json")) {
          setRecs([]);
          setError("Sin sugerencias disponibles");
          return;
        }
        const data = await res.json();
        setRecs(data.recomendaciones ?? []);
        setAgregados(new Set()); // reset al actualizar
      } catch {
        clearTimeout(timeoutId);
        setRecs([]);
        setError("Sin sugerencias disponibles");
      } finally {
        setLoading(false);
      }
    }, 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      fetchControllerRef.current?.abort();
    };
  }, [clienteId, mascotaId]); // NO incluir items[] — no re-disparar por cada ítem

  function handleAgregar(rec: Recomendacion) {
    addItem({
      producto_id: rec.producto_id,
      nombre:      rec.nombre,
      precio:      rec.precio,
      cantidad:    1,
      subtotal:    rec.precio,
    });
    setAgregados((prev) => new Set(prev).add(rec.producto_id));
  }

  // No renderizar si no hay cliente. Mientras haya cliente, el panel se
  // mantiene siempre montado (con el mismo alto mínimo) — nunca colapsa a
  // null entre estados de carga/resultado/vacío, para no desplazar el botón
  // "Cobrar" que está justo debajo (ver src/app/(app)/pos/page.tsx).
  if (!clienteId) return null;

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
      <p className="text-xs font-semibold text-blue-700 mb-2">🤖 Sugerencias IA</p>

      {loading && (
        <p className="text-xs text-blue-500 animate-pulse">Buscando sugerencias...</p>
      )}

      {!loading && error && (
        <p className="text-xs text-blue-400">{error}</p>
      )}

      {!loading && !error && recs.length === 0 && (
        <p className="text-xs text-gray-400">Sin sugerencias para este cliente por ahora.</p>
      )}

      {!loading && !error && recs.map((rec) => {
        const yaAgregado = agregados.has(rec.producto_id);
        const urgenciaColor = {
          alta: "bg-red-100 text-red-700",
          media: "bg-yellow-100 text-yellow-700",
          baja: "bg-green-100 text-green-700",
        }[rec.urgencia];

        return (
          <div key={rec.producto_id} className="flex items-start justify-between gap-2 mb-2 last:mb-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 mb-1">
                <p className="text-xs font-medium text-gray-800 truncate">{rec.nombre}</p>
                <span className={`text-xs px-1 py-0.5 rounded-full ${urgenciaColor}`}>
                  {rec.urgencia}
                </span>
              </div>
              <p className="text-xs text-gray-500 leading-tight">{rec.razon}</p>
              <p className="text-xs text-gray-700 font-medium">
                ${rec.precio.toLocaleString("es-CL")}
              </p>
            </div>
            <button
              onClick={() => handleAgregar(rec)}
              disabled={yaAgregado}
              className={`flex-shrink-0 text-xs px-2 py-1 rounded font-medium transition-colors ${
                yaAgregado
                  ? "bg-green-100 text-green-700 cursor-default"
                  : "bg-blue-500 text-white hover:bg-blue-600"
              }`}
            >
              {yaAgregado ? "✓" : "+"}
            </button>
          </div>
        );
      })}
    </div>
  );
}