"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";

interface CanalInfo {
  id: string;
  nombre: string;
  descripcion: string;
  color: string;
  icono: string;
  campos: { key: string; label: string; type: string; placeholder: string }[];
}

const CANALES_INFO: Record<string, CanalInfo> = {
  rappi: {
    id: "rappi",
    nombre: "Rappi",
    descripcion: "Configura tu integración con Rappi",
    color: "bg-red-500",
    icono: "🛵",
    campos: [
      { key: "api_key", label: "API Key", type: "password", placeholder: "rk_live_..." },
      { key: "api_secret", label: "API Secret", type: "password", placeholder: "ws_rappi_..." },
      { key: "store_id", label: "Store ID", type: "text", placeholder: "12345" },
      { key: "webhook_secret", label: "Webhook Secret", type: "password", placeholder: "whsec_..." },
    ],
  },
  pedidosya: {
    id: "pedidosya",
    nombre: "PedidosYa",
    descripcion: "Configura tu integración con PedidosYa",
    color: "bg-yellow-500",
    icono: "📦",
    campos: [
      { key: "client_id", label: "Client ID", type: "text", placeholder: "..." },
      { key: "client_secret", label: "Client Secret", type: "password", placeholder: "..." },
      { key: "business_id", label: "Business ID", type: "text", placeholder: "..." },
    ],
  },
  ubereats: {
    id: "ubereats",
    nombre: "Uber Eats",
    descripcion: "Configura tu integración con Uber Eats",
    color: "bg-black",
    icono: "🍔",
    campos: [
      { key: "client_id", label: "Client ID", type: "text", placeholder: "..." },
      { key: "client_secret", label: "Client Secret", type: "password", placeholder: "..." },
      { key: "store_uuid", label: "Store UUID", type: "text", placeholder: "..." },
    ],
  },
};

export default function CanalConfigPage() {
  const router = useRouter();
  const params = useParams();
  const canalId = params.canal as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [activo, setActivo] = useState(false);
  const [credenciales, setCredenciales] = useState<Record<string, string>>({});

  const canalInfo = CANALES_INFO[canalId];

  useEffect(() => {
    if (!canalInfo) {
      router.push("/canales");
      return;
    }

    fetch("/api/canales/config")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const config = data.find((c: { canal_id: string }) => c.canal_id === canalId);
          if (config) {
            setActivo(config.activo);
          }
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Error cargando configuración");
        setLoading(false);
      });
  }, [canalId, canalInfo, router]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canalInfo) return;

    setSaving(true);
    setError("");

    const res = await fetch("/api/canales/config", {
      method: credenciales ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        canal_id: canalId,
        credenciales,
        activo,
      }),
    });

    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      const data = await res.json();
      setError(data.error ?? "Error guardando");
    }
  }

  if (loading) return <div className="text-gray-500">Cargando...</div>;
  if (!canalInfo) return null;

  return (
    <div className="max-w-xl">
      <button
        onClick={() => router.push("/canales")}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        ← Volver a Canales
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className={`w-10 h-10 rounded-lg ${canalInfo.color} flex items-center justify-center text-xl`}>
          {canalInfo.icono}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{canalInfo.nombre}</h1>
          <p className="text-sm text-gray-500">{canalInfo.descripcion}</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="space-y-4">
          {canalInfo.campos.map((campo) => (
            <div key={campo.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {campo.label}
              </label>
              <input
                type={campo.type}
                value={credenciales[campo.key] ?? ""}
                onChange={(e) =>
                  setCredenciales({ ...credenciales, [campo.key]: e.target.value })
                }
                placeholder={campo.placeholder}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          ))}

          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <div>
              <span className="text-sm font-medium text-gray-700">Estado</span>
              <p className="text-xs text-gray-500">
                {activo ? "Canal activo, recibe pedidos" : "Canal inactivo"}
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-gray-600">{activo ? "Activo" : "Inactivo"}</span>
              <div
                onClick={() => setActivo(!activo)}
                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${activo ? "bg-green-500" : "bg-gray-300"}`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    activo ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </div>
            </label>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3 mt-6">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar configuración"}
          </button>
          {saved && <span className="text-sm text-green-600 font-medium">Guardado</span>}
        </div>
      </form>
    </div>
  );
}