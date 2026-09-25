"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { CanalOrdenRow } from "@/types";

// Pedidos de canales externos (paso 3.8). Una sola vista para todos los
// canales (reemplaza las tres copias por canal). La aceptación es automática
// (D5); el equipo solo prepara y marca "lista para retiro" (D8). El botón
// "Reintentar" de órdenes fallidas se muestra solo a admin — es una
// conveniencia de UX: el control real es el servidor
// (POST /api/canales/orders/[id]/retry exige storeAdmin/systemAdmin).

type Orden = Pick<
  CanalOrdenRow,
  "id" | "canal_id" | "external_order_id" | "estado" | "items" | "total_externo" | "ultimo_error" | "created_at" | "ready_at"
>;

const NOMBRE_CANAL: Record<string, string> = { rappi: "Rappi", pedidosya: "PedidosYa", ubereats: "Uber Eats" };
const ETIQUETA_ESTADO: Record<string, string> = {
  processing: "Procesando",
  accepted: "Por preparar",
  ready: "Lista para retiro",
  failed: "Fallida",
};
export const INTERVALO_MS = 10_000;

function minutosDesde(fecha: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(fecha).getTime()) / 60_000));
}

export default function PedidosCanales({ canal }: { canal?: string }) {
  const { sessionClaims } = useAuth();
  const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
  const esAdmin = Boolean(meta?.storeAdmin || meta?.systemAdmin);

  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [procesando, setProcesando] = useState<string | null>(null);
  const [nuevos, setNuevos] = useState(0);
  const vistos = useRef<Set<string> | null>(null);

  const cargar = useCallback(async () => {
    try {
      const qs = canal ? `?canal=${encodeURIComponent(canal)}` : "";
      const res = await fetch(`/api/canales/orders${qs}`);
      if (!res.ok) throw new Error();
      const data: Orden[] = await res.json();
      setOrdenes(data);
      setErrorCarga(null);
      // Alerta visual de pedido nuevo por preparar (desde la primera carga).
      const porPreparar = data.filter((o) => o.estado === "accepted").map((o) => o.id);
      if (vistos.current) {
        const recientes = porPreparar.filter((id) => !vistos.current!.has(id)).length;
        if (recientes > 0) setNuevos((n) => n + recientes);
      }
      vistos.current = new Set([...(vistos.current ?? []), ...porPreparar]);
    } catch {
      setErrorCarga("No se pudieron cargar los pedidos");
    } finally {
      setCargando(false);
    }
  }, [canal]);

  useEffect(() => {
    cargar();
    const id = setInterval(cargar, INTERVALO_MS);
    return () => clearInterval(id);
  }, [cargar]);

  async function accion(ordenId: string, ruta: "ready" | "retry") {
    setProcesando(ordenId);
    setErrorAccion(null);
    try {
      const res = await fetch(`/api/canales/orders/${ordenId}/${ruta}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorAccion(body.error ?? "No se pudo completar la acción");
      }
      await cargar();
    } catch {
      setErrorAccion("No se pudo completar la acción — revisa tu conexión");
    } finally {
      setProcesando(null);
    }
  }

  if (cargando) return <p className="text-gray-500">Cargando pedidos...</p>;

  return (
    <div className="space-y-4">
      {nuevos > 0 && (
        <div role="status" className="flex items-center justify-between rounded-md border border-green-300 bg-green-50 p-3 text-sm font-medium text-green-800">
          <span>🔔 {nuevos === 1 ? "Llegó un pedido nuevo" : `Llegaron ${nuevos} pedidos nuevos`}</span>
          <button type="button" onClick={() => setNuevos(0)} className="text-green-700 hover:underline">Entendido</button>
        </div>
      )}
      {errorCarga && <p role="alert" className="text-sm text-red-600">{errorCarga}</p>}
      {errorAccion && <p role="alert" className="text-sm text-red-600">{errorAccion}</p>}

      {ordenes.length === 0 ? (
        <p className="py-12 text-center text-gray-400">No hay pedidos activos</p>
      ) : (
        <ul className="space-y-3">
          {ordenes.map((o) => (
            <li key={o.id} className={`rounded-lg border bg-white p-4 ${o.estado === "accepted" ? "border-green-300" : o.estado === "failed" ? "border-red-300" : "border-gray-200"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">
                    {NOMBRE_CANAL[o.canal_id] ?? o.canal_id} · <span className="font-mono">#{o.external_order_id}</span>
                  </p>
                  <p className="text-xs text-gray-500">hace {minutosDesde(o.created_at)} min</p>
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                  {ETIQUETA_ESTADO[o.estado] ?? o.estado}
                </span>
              </div>

              <ul className="mt-2 space-y-0.5 text-sm text-gray-700">
                {(o.items ?? []).map((i, idx) => (
                  <li key={`${i.sku}-${idx}`}>{i.cantidad} × {i.nombre ?? i.sku}</li>
                ))}
              </ul>
              {o.total_externo != null && (
                <p className="mt-1 text-sm font-medium text-gray-800">${Number(o.total_externo).toLocaleString("es-CL")}</p>
              )}
              {o.estado === "failed" && o.ultimo_error && (
                <p className="mt-1 text-xs text-red-600">{o.ultimo_error}</p>
              )}

              <div className="mt-3">
                {o.estado === "accepted" && (
                  <button
                    type="button"
                    onClick={() => accion(o.id, "ready")}
                    disabled={procesando === o.id}
                    className="w-full rounded-md bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {procesando === o.id ? "Marcando..." : "Marcar lista para retiro"}
                  </button>
                )}
                {o.estado === "failed" && (esAdmin ? (
                  <button
                    type="button"
                    onClick={() => accion(o.id, "retry")}
                    disabled={procesando === o.id}
                    className="w-full rounded-md bg-amber-100 py-2 text-sm font-medium text-amber-800 hover:bg-amber-200 disabled:opacity-50"
                  >
                    {procesando === o.id ? "Reintentando..." : "Reintentar"}
                  </button>
                ) : (
                  <p className="text-xs text-gray-500">Requiere que un administrador la reintente.</p>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
