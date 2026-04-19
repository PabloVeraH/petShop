"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Orden {
  id: string;
  external_order_id: string;
  estado: string;
  total_externo: number;
  created_at: string;
  accepted_at?: string;
  rejected_at?: string;
}

const ESTADOS_ACTIVOS = ["pending", "reserved", "accepted", "ready"];

export default function RappiOrdenesPage() {
  const router = useRouter();
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [loading, setLoading] = useState(true);
  const [procesando, setProcesando] = useState<string | null>(null);

  const fetchOrdenes = useCallback(async () => {
    try {
      const res = await fetch("/api/canales/orders?canal=rappi");
      const data = await res.json();
      if (Array.isArray(data)) {
        setOrdenes(data.filter((o) => ESTADOS_ACTIVOS.includes(o.estado)));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrdenes();
    const interval = setInterval(fetchOrdenes, 10000);
    return () => clearInterval(interval);
  }, [fetchOrdenes]);

  async function handleAccept(ordenId: string) {
    setProcesando(ordenId);
    try {
      const res = await fetch(`/api/canales/orders/${ordenId}/accept`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchOrdenes();
      }
    } finally {
      setProcesando(null);
    }
  }

  async function handleReject(ordenId: string) {
    setProcesando(ordenId);
    try {
      const res = await fetch(`/api/canales/orders/${ordenId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Rechazado por el operador" }),
      });
      if (res.ok) {
        await fetchOrdenes();
      }
    } finally {
      setProcesando(null);
    }
  }

  if (loading) return <div className="text-gray-500">Cargando órdenes...</div>;

  return (
    <div className="max-w-3xl">
      <button
        onClick={() => router.push("/canales")}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        ← Voler a Canales
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-lg bg-red-500 flex items-center justify-center text-lg">
          🛵
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">Órdenes Rappi</h1>
          <p className="text-sm text-gray-500">Órdenes activas pendientes</p>
        </div>
      </div>

      {ordenes.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No hay órdenes activas
        </div>
      ) : (
        <div className="space-y-3">
          {ordenes.map((orden) => (
            <div
              key={orden.id}
              className={`bg-white rounded-lg border p-4 ${
                orden.estado === "pending" ? "border-yellow-300 bg-yellow-50" : "border-gray-200"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono text-sm text-gray-600">
                    #{orden.external_order_id}
                  </p>
                  <p className="text-lg font-bold text-gray-800 mt-1">
                    ${orden.total_externo?.toLocaleString("es-CL") ?? 0}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(orden.created_at).toLocaleString("es-CL")}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${
                      orden.estado === "pending"
                        ? "bg-yellow-100 text-yellow-700"
                        : orden.estado === "accepted"
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {orden.estado}
                  </span>
                </div>
              </div>

              {orden.estado === "pending" && (
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => handleAccept(orden.id)}
                    disabled={procesando === orden.id}
                    className="flex-1 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
                  >
                    {procesando === orden.id ? "Aceptando..." : "Aceptar"}
                  </button>
                  <button
                    onClick={() => handleReject(orden.id)}
                    disabled={procesando === orden.id}
                    className="flex-1 py-2 bg-red-100 text-red-700 text-sm font-medium rounded-md hover:bg-red-200 disabled:opacity-50"
                  >
                    {procesando === orden.id ? "Rechazando..." : "Rechazar"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}