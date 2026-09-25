"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

// Alertas de canales externos (Fase 5, 5.3): llamadas detenidas o
// reintentando, credenciales/token rechazados, pedidos fallidos y menú
// rechazado. Solo admin: el servidor responde 403 a otros roles y aquí no se
// muestra nada en ese caso (la página /canales ya es solo para admin).

interface Alerta {
  tipo: "credenciales" | "llamada_detenida" | "llamada_reintentando" | "orden_fallida" | "menu_rechazado";
  severidad: "alta" | "media";
  canal_id: string;
  mensaje: string;
  detalle: string | null;
  fecha: string | null;
  outbox_id?: string;
}

const NOMBRE_CANAL: Record<string, string> = { rappi: "Rappi", pedidosya: "PedidosYa", ubereats: "Uber Eats" };

function accion(a: Alerta): { href: string; texto: string } | null {
  if (a.tipo === "credenciales") return { href: `/canales/${a.canal_id}`, texto: "Revisar configuración" };
  if (a.tipo === "menu_rechazado") return { href: `/canales/${a.canal_id}/catalogo`, texto: "Revisar catálogo" };
  if (a.tipo === "orden_fallida") return { href: `/pos/pedidos?canal=${a.canal_id}`, texto: "Ver pedidos" };
  return null;
}

export default function AlertasCanales() {
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/canales/alertas");
    if (res.status === 403) {
      setAlertas([]);
      return;
    }
    if (!res.ok) {
      setError("No se pudieron cargar las alertas de canales");
      return;
    }
    const data = await res.json();
    setAlertas(Array.isArray(data.alertas) ? data.alertas : []);
  }, []);

  useEffect(() => {
    cargar().catch(() => setError("No se pudieron cargar las alertas de canales"));
  }, [cargar]);

  async function reintentar(id: string) {
    setError("");
    setAviso("");
    setOcupado(id);
    try {
      const res = await fetch("/api/canales/alertas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError((data && data.error) || "No se pudo reintentar");
        return;
      }
      setAviso("Reintento en curso.");
      await cargar();
    } catch {
      setError("Error de red al reintentar");
    } finally {
      setOcupado(null);
    }
  }

  if (error && !alertas) {
    return <p role="alert" className="mb-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  }
  if (!alertas || alertas.length === 0) return null;

  return (
    <section aria-label="Alertas de canales" className="mb-8 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h2 className="text-sm font-semibold text-amber-900 mb-3">
        {alertas.length} alerta{alertas.length === 1 ? "" : "s"} de canales externos
      </h2>
      {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
      {aviso && <p role="status" className="mb-2 text-sm text-green-700">{aviso}</p>}
      <ul className="space-y-2">
        {alertas.map((a, i) => {
          const link = accion(a);
          return (
            <li key={`${a.tipo}-${a.outbox_id ?? i}`} className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-white p-3 text-sm">
              <div>
                <span className={`mr-2 text-xs font-medium ${a.severidad === "alta" ? "text-red-700" : "text-amber-700"}`}>
                  {NOMBRE_CANAL[a.canal_id] ?? a.canal_id}
                </span>
                <span className="text-gray-800">{a.mensaje}</span>
                {a.detalle && <p className="text-xs text-gray-500 mt-0.5">{a.detalle}</p>}
              </div>
              <div className="flex items-center gap-2">
                {a.tipo === "llamada_detenida" && a.outbox_id && (
                  <button
                    onClick={() => reintentar(a.outbox_id!)}
                    disabled={ocupado !== null}
                    className="px-2 py-1 border border-gray-300 text-xs rounded-md hover:bg-gray-50 disabled:opacity-50"
                  >
                    Reintentar
                  </button>
                )}
                {link && (
                  <Link href={link.href} className="text-xs text-blue-600 hover:underline">
                    {link.texto}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
