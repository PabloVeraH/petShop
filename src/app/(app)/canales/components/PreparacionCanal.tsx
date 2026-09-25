"use client";

import { useEffect, useState } from "react";

// Checklist de salida a producción (Fase 6, 6.2): qué falta para operar el
// canal en producción y las URLs del webhook a registrar en la plataforma.
// Solo admin: el servidor responde 403 a otros roles.

interface Item {
  id: string;
  titulo: string;
  estado: "ok" | "pendiente" | "error";
  detalle: string;
}

interface Respuesta {
  listo: boolean;
  items: Item[];
  webhook: { urls: { evento: string | null; url: string }[] };
}

const ICONO: Record<Item["estado"], { simbolo: string; clase: string; etiqueta: string }> = {
  ok: { simbolo: "✓", clase: "text-green-600", etiqueta: "listo" },
  pendiente: { simbolo: "•", clase: "text-amber-600", etiqueta: "pendiente" },
  error: { simbolo: "✗", clase: "text-red-600", etiqueta: "requiere acción" },
};

export default function PreparacionCanal({ canalId, nombre }: { canalId: string; nombre: string }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const [copiado, setCopiado] = useState<string | null>(null);

  // "Volver a verificar" incrementa version y el efecto vuelve a consultar.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const res = await fetch(`/api/canales/${canalId}/preparacion`);
      const data = await res.json().catch(() => null);
      if (!vigente) return;
      // Una respuesta con otra forma no debe romper la página del canal.
      if (!res.ok || !Array.isArray(data?.items) || !Array.isArray(data?.webhook?.urls)) {
        setError((data && data.error) || "No se pudo cargar la preparación del canal");
        return;
      }
      setError("");
      setDatos(data as Respuesta);
    })().catch(() => {
      if (vigente) setError("No se pudo cargar la preparación del canal");
    });
    return () => {
      vigente = false;
    };
  }, [canalId, version]);

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(url);
    } catch {
      setError("No se pudo copiar: selecciona la URL manualmente");
    }
  }

  return (
    <section aria-label={`Preparación ${nombre}`} className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-800">Preparación para producción</h2>
        <div className="flex items-center gap-3">
          {datos && (
            <span className={`text-xs px-2 py-1 rounded-full ${datos.listo ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
              {datos.listo ? "Listo" : "Faltan pasos"}
            </span>
          )}
          <button
            onClick={() => setVersion((v) => v + 1)}
            className="text-xs text-blue-600 hover:underline"
          >
            Volver a verificar
          </button>
        </div>
      </div>

      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}

      {datos && (
        <>
          <ul className="space-y-2">
            {datos.items.map((i) => (
              <li key={i.id} className="flex gap-2 text-sm">
                <span className={`font-bold ${ICONO[i.estado].clase}`} aria-label={ICONO[i.estado].etiqueta}>
                  {ICONO[i.estado].simbolo}
                </span>
                <div>
                  <span className="text-gray-800">{i.titulo}</span>
                  <p className="text-xs text-gray-500">{i.detalle}</p>
                </div>
              </li>
            ))}
          </ul>

          <h3 className="mt-5 text-sm font-medium text-gray-700">URLs del webhook a registrar en {nombre}</h3>
          <p className="text-xs text-gray-500 mb-2">
            Una por evento, cada una con el secreto que entregue la plataforma. Deben apuntar al dominio de producción.
          </p>
          <ul className="space-y-1">
            {datos.webhook.urls.map((u) => (
              <li key={u.url} className="flex items-center gap-2 text-xs">
                {u.evento && <span className="w-40 shrink-0 font-mono text-gray-600">{u.evento}</span>}
                <code className="flex-1 truncate rounded bg-gray-50 px-2 py-1 text-gray-700">{u.url}</code>
                <button
                  onClick={() => copiar(u.url)}
                  aria-label={`Copiar URL ${u.evento ?? ""}`.trim()}
                  className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  {copiado === u.url ? "Copiada" : "Copiar"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
