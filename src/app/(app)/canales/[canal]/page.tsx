"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  CAMPOS_CREDENCIALES,
  CANALES_INTEGRACION_PENDIENTE,
  type CampoCredencial,
  type CanalConfigurableId,
} from "@/lib/canales/campos";
import LiquidacionesCanal from "../components/LiquidacionesCanal";
import PreparacionCanal from "../components/PreparacionCanal";

interface CanalInfo {
  id: CanalConfigurableId;
  nombre: string;
  descripcion: string;
  color: string;
  icono: string;
  useImage?: boolean;
  // Fuente única con la validación del servidor (lib/canales/campos.ts — C5).
  campos: CampoCredencial[];
}

const CANALES_INFO: Record<string, CanalInfo> = {
  rappi: {
    id: "rappi",
    nombre: "Rappi",
    descripcion: "Configura tu integración con Rappi",
    color: "bg-red-500",
    icono: "🛵",
    campos: CAMPOS_CREDENCIALES.rappi,
  },
  pedidosya: {
    id: "pedidosya",
    nombre: "PedidosYa",
    descripcion: "Configura tu integración con PedidosYa",
    color: "bg-yellow-500",
    icono: "📦",
    campos: CAMPOS_CREDENCIALES.pedidosya,
  },
  ubereats: {
    id: "ubereats",
    nombre: "Uber Eats",
    descripcion: "Configura tu integración con Uber Eats",
    color: "bg-black",
    icono: "🍔",
    campos: CAMPOS_CREDENCIALES.ubereats,
  },
  instagram: {
    id: "instagram",
    nombre: "Instagram",
    descripcion: "Conecta tu cuenta profesional",
    color: "bg-gradient-to-tr from-purple-500 via-pink-500 to-orange-400",
    icono: "/logos/instagram.jpeg",
    useImage: true,
    campos: CAMPOS_CREDENCIALES.instagram,
  },
};

export default function CanalConfigPage() {
  const router = useRouter();
  const params = useParams();
  const canalId = params?.canal as string | undefined;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [activo, setActivo] = useState(false);
  const [credenciales, setCredenciales] = useState<Record<string, string>>({});
  const [configExists, setConfigExists] = useState(false);
  const [tieneCredencialesGuardadas, setTieneCredencialesGuardadas] = useState(false);

  const canalInfo = canalId ? CANALES_INFO[canalId] : undefined;
  // 2.7: sin adaptador real todavía — se pueden guardar credenciales, no activar
  // (el servidor responde 409 igual; esto es solo UX).
  const integracionPendiente = !!canalInfo && CANALES_INTEGRACION_PENDIENTE.includes(canalInfo.id);

  useEffect(() => {
    if (!canalId || !canalInfo) {
      if (!canalId) return;
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
            setConfigExists(true);
            setTieneCredencialesGuardadas(!!config.tiene_credenciales);
          }
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Error cargando configuración");
        setLoading(false);
      });
  }, [canalId, canalInfo]);

  const allCredentialsFilled = canalInfo
    ? canalInfo.campos.every((campo) => credenciales[campo.key] && credenciales[campo.key].trim() !== "")
    : false;

  // Reactivar un canal ya configurado no debe exigir reingresar credenciales
  // que el backend ya tiene almacenadas (ticket Trello
  // 6a5f9b146418dc26e56d7274): el formulario nunca las precarga (no se
  // desencriptan por seguridad), así que bloquear solo por
  // allCredentialsFilled rechazaba una reactivación legítima antes de
  // siquiera intentar el request. El backend (PATCH) sigue siendo la
  // autoridad final: si el usuario edita algún campo sin completar todos,
  // el 422 existente de allCredentialsFilled server-side lo sigue cubriendo.
  const puedeActivar = allCredentialsFilled || (configExists && tieneCredencialesGuardadas);

  // MEJORA (ticket Trello 6a62eb3669e64e3d5cf110d0): checklist visual de
  // pasos pendientes para canales de delivery inactivos. Por campo: se
  // considera "configurado" si ya está escrito en el formulario actual, O si
  // el canal ya tiene credenciales guardadas en el backend (tiene_credenciales
  // es un booleano agregado — allCredentialsFilled se exige server-side antes
  // de persistir cualquier credencial, ver POST/PATCH /api/canales/config, así
  // que tiene_credenciales=true implica que TODOS los campos ya están
  // guardados, no solo algunos). No se incluye un paso de "Webhook
  // registrado" como el ejemplo del ticket: el webhook de canales solo está
  // implementado para Rappi (POST /api/canales/webhook/[canal] rechaza
  // pedidosya/ubereats con 404 "Canal no disponible", ver adapters/registry.ts) — mostrar ese
  // paso para los otros dos canales sería instrucción falsa.
  const yaGuardado = configExists && tieneCredencialesGuardadas;
  const camposEstado = canalInfo?.campos.map((campo) => ({
    ...campo,
    completado: yaGuardado || (credenciales[campo.key]?.trim() ?? "") !== "",
  })) ?? [];

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canalInfo) return;

    if (activo && integracionPendiente) {
      setError("Integración pendiente: este canal aún no se puede activar");
      return;
    }

    if (activo && !puedeActivar) {
      setError("Debe completar todas las credenciales antes de activar el canal");
      return;
    }

    setSaving(true);
    setError("");

    const res = await fetch("/api/canales/config", {
      method: configExists ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        canal_id: canalId,
        credenciales,
        activo,
      }),
    });

    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      setConfigExists(true);
      setActivo(data.activo ?? activo);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      const data = await res.json();
      setError(data.error ?? "Error guardando");
    }
  }

  if (!canalId || loading) return <div className="text-gray-500">Cargando...</div>;
  if (!canalInfo) return null;

  const isDashboardAvailable = canalId === "instagram" && configExists && activo;
  // Fase 4 (4.4): catálogo y precios del canal (la página valida el rol en el servidor).
  const isCatalogoAvailable = canalId !== "instagram" && configExists && !integracionPendiente;

  return (
    <div className="max-w-xl">
      <div className="mb-4">
        <button
          onClick={() => router.push("/canales")}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Volver a Canales
        </button>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className={`w-10 h-10 rounded-lg ${canalInfo.useImage ? "" : canalInfo.color} flex items-center justify-center text-xl overflow-hidden`}>
          {canalInfo.useImage ? (
            <img src={canalInfo.icono} alt={canalInfo.nombre} className="w-full h-full object-contain" />
          ) : (
            <span>{canalInfo.icono}</span>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{canalInfo.nombre}</h1>
          <p className="text-sm text-gray-500">{canalInfo.descripcion}</p>
        </div>
      </div>

      {integracionPendiente && (
        <div role="status" className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Integración pendiente: {canalInfo.nombre} aún no está disponible. Puedes guardar las
          credenciales, pero el canal no se puede activar hasta tener la integración oficial.
        </div>
      )}

      {canalId !== "instagram" && !activo && (
        <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-3 space-y-1.5">
          <p className="text-xs font-medium text-gray-600 mb-1">
            Pasos para activar {canalInfo.nombre}
          </p>
          {camposEstado.map((campo) => (
            <div key={campo.key} className="flex items-center gap-2 text-sm">
              <span className={campo.completado ? "text-green-600" : "text-gray-400"}>
                {campo.completado ? "✓" : "✗"}
              </span>
              <span className={campo.completado ? "text-gray-700" : "text-gray-500"}>
                {campo.label} {campo.completado ? "configurada" : "pendiente"}
              </span>
            </div>
          ))}
        </div>
      )}

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
                // Credenciales de un canal externo, no un login del usuario actual.
                // "new-password" para type="password" es más confiable entre
                // navegadores que "off" para evitar que el gestor de contraseñas
                // sugiera credenciales guardadas de otro contexto; "off" para el
                // resto (Store ID, Client ID, etc. — identificadores, no logins).
                autoComplete={campo.type === "password" ? "new-password" : "off"}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          ))}

          <div className="flex items-start justify-between pt-4 border-t border-gray-200">
            <div>
              <span className="text-sm font-medium text-gray-700">Estado</span>
              <p className="text-xs text-gray-500">
                {activo ? "Canal activo, recibe pedidos" : "Canal inactivo"}
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-gray-600">{activo ? "Activo" : "Inactivo"}</span>
              <div
                onClick={() => { setActivo(!activo); setError(""); }}
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

        <div className="flex items-center justify-between mt-6">
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar configuración"}
            </button>
            {saved && <span className="text-sm text-green-600 font-medium">Guardado</span>}
          </div>
          {isDashboardAvailable && (
            <button
              type="button"
              onClick={() => router.push("/canales/instagram/posts")}
              className="px-5 py-2 bg-blue-500 text-white text-sm font-medium rounded-md hover:bg-blue-600"
            >
              Gestionar publicaciones
            </button>
          )}
          {isCatalogoAvailable && (
            <button
              type="button"
              onClick={() => router.push(`/canales/${canalId}/catalogo`)}
              className="px-5 py-2 bg-blue-500 text-white text-sm font-medium rounded-md hover:bg-blue-600"
            >
              Catálogo y precios
            </button>
          )}
        </div>
      </form>

      {isCatalogoAvailable && <PreparacionCanal canalId={canalInfo.id} nombre={canalInfo.nombre} />}
      {isCatalogoAvailable && <LiquidacionesCanal canalId={canalInfo.id} nombre={canalInfo.nombre} />}
    </div>
  );
}