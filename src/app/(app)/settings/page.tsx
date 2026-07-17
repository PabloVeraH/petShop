"use client";

import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import StoreLocationPicker from "@/components/StoreLocationPicker";
import { computeLicenseStatus } from "@/lib/license";

interface FidelizacionNivel {
  monto: number;
  descuento: number;
}

interface StoreSettings {
  id: string;
  name: string;
  rut: string;
  address: string;
  phone: string;
  email: string;
  whatsapp_enabled: boolean;
  whatsapp_phone_number_id: string;
  whatsapp_access_token: string;
  whatsapp_webhook_verify_token: string;
  email_reminder_enabled: boolean;
  email_reminder_dias_aviso: number;
  resend_from_email: string;
  fidelizacion_niveles: FidelizacionNivel[];
  license_start_date: string | null;
  license_end_date: string | null;
  license_warning_days: number;
  ciudad: string;
  lat: number | null;
  lon: number | null;
  direccion: string | null;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { sessionClaims } = useAuth();
  const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
  const currentRole: "systemAdmin" | "storeAdmin" | "storeWorker" | null =
    meta?.systemAdmin ? "systemAdmin" : meta?.storeAdmin ? "storeAdmin" : meta?.storeWorker ? "storeWorker" : null;

  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [sendingAlerts, setSendingAlerts] = useState(false);
  const [alertsResult, setAlertsResult] = useState<{ sent: number; skipped: number } | null>(null);

  const handleSendAlerts = useCallback(async () => {
    setSendingAlerts(true);
    setAlertsResult(null);
    const res = await fetch("/api/email/send-alerts", { method: "POST" });
    const data = await res.json();
    setSendingAlerts(false);
    if (res.ok) setAlertsResult(data);
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => { setSettings(d); setLoading(false); })
      .catch(() => { setError("Error cargando configuración"); setLoading(false); });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      queryClient.invalidateQueries({ queryKey: ["store-name"] });
    } else {
      const d = await res.json();
      setError(d.error ?? "Error guardando");
    }
  }

  if (loading) return <div className="text-gray-500">Cargando...</div>;
  if (!settings) return <div className="text-red-500">{error || "Error"}</div>;

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/whatsapp/webhook`
    : "/api/whatsapp/webhook";

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Configuración</h1>

      <form onSubmit={handleSave} className="space-y-8">
        {/* Store Info */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Datos de la tienda</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input
                type="text"
                value={settings.name ?? ""}
                onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">RUT</label>
              <input
                type="text"
                value={settings.rut ?? ""}
                onChange={(e) => setSettings({ ...settings, rut: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
              <input
                type="text"
                value={settings.phone ?? ""}
                onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={settings.email ?? ""}
                onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
              <input
                type="text"
                value={settings.address ?? ""}
                onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
        </section>

        {/* Ubicación */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-1">Ubicación de la tienda</h2>
          <p className="text-xs text-gray-400 mb-4">
            Se usa para obtener el clima local y mejorar las recomendaciones IA en el POS.
          </p>
          <StoreLocationPicker
            direccion={settings.direccion ?? ""}
            ciudad={settings.ciudad ?? ""}
            lat={settings.lat}
            lon={settings.lon}
            onChange={({ direccion, ciudad, lat, lon }) =>
              setSettings({ ...settings, direccion, ciudad, lat, lon })
            }
          />
        </section>

        {/* WhatsApp */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-700">WhatsApp (Meta Cloud API)</h2>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-gray-600">Activado</span>
              <div
                onClick={() => setSettings({ ...settings, whatsapp_enabled: !settings.whatsapp_enabled })}
                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${settings.whatsapp_enabled ? "bg-green-500" : "bg-gray-300"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.whatsapp_enabled ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
            </label>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number ID</label>
              <input
                type="text"
                value={settings.whatsapp_phone_number_id ?? ""}
                onChange={(e) => setSettings({ ...settings, whatsapp_phone_number_id: e.target.value })}
                placeholder="123456789012345"
                autoComplete="off"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-xs text-gray-400 mt-1">Obtenido en Meta Developer Console → WhatsApp → API Setup</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Access Token</label>
              <input
                type="password"
                value={settings.whatsapp_access_token ?? ""}
                onChange={(e) => setSettings({ ...settings, whatsapp_access_token: e.target.value })}
                placeholder="EAAxxxx..."
                // "new-password", no "off": más confiable entre navegadores para
                // evitar que el gestor de contraseñas sugiera credenciales de otro
                // contexto en un campo type="password" que no es un login real.
                autoComplete="new-password"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-xs text-gray-400 mt-1">Token permanente generado en Meta Business Manager</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Verify Token (webhook)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings.whatsapp_webhook_verify_token ?? ""}
                  onChange={(e) => setSettings({ ...settings, whatsapp_webhook_verify_token: e.target.value })}
                  placeholder="mi-token-secreto-123"
                  autoComplete="off"
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, whatsapp_webhook_verify_token: crypto.randomUUID().replace(/-/g, "") })}
                  className="px-3 py-2 text-sm bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 border border-gray-300"
                >
                  Generar
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Token que configuras en Meta al registrar el webhook</p>
            </div>

            <div className="bg-gray-50 rounded-md p-3 border border-gray-200">
              <p className="text-xs font-medium text-gray-600 mb-1">URL del Webhook (registrar en Meta)</p>
              <code className="text-xs text-gray-700 break-all">{webhookUrl}</code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(webhookUrl)}
                className="mt-2 text-xs text-green-600 hover:underline"
              >
                Copiar
              </button>
            </div>
          </div>
        </section>

        {/* Email Reminder */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-700">Recordatorio de alimento por email</h2>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-gray-600">Activado</span>
              <div
                onClick={() => setSettings({ ...settings, email_reminder_enabled: !settings.email_reminder_enabled })}
                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${settings.email_reminder_enabled ? "bg-green-500" : "bg-gray-300"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.email_reminder_enabled ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
            </label>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Días de anticipación</label>
              <input
                type="number"
                value={settings.email_reminder_dias_aviso ?? 5}
                onChange={(e) => setSettings({ ...settings, email_reminder_dias_aviso: parseInt(e.target.value) || 5 })}
                min={1}
                max={30}
                className="w-24 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-xs text-gray-400 mt-1">Cuántos días antes de que se acabe se envía el recordatorio</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email remitente (opcional)</label>
              <input
                type="email"
                value={settings.resend_from_email ?? ""}
                onChange={(e) => setSettings({ ...settings, resend_from_email: e.target.value })}
                placeholder="tienda@midominio.com"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-xs text-gray-400 mt-1">Si está vacío, se usa el email por defecto del sistema</p>
            </div>
          </div>
        </section>

        {/* Fidelización */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-1">Niveles de fidelización</h2>
          <p className="text-xs text-gray-400 mb-4">Define los umbrales de compra acumulada y el descuento asociado a cada nivel.</p>
          <div className="space-y-3">
            {(settings.fidelizacion_niveles ?? []).map((nivel, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm text-gray-500 w-16 shrink-0">Nivel {i + 1}</span>
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-sm text-gray-600">$</span>
                  <input
                    type="number"
                    value={nivel.monto}
                    onChange={(e) => {
                      const nuevos = [...settings.fidelizacion_niveles];
                      nuevos[i] = { ...nuevos[i], monto: parseInt(e.target.value) || 0 };
                      setSettings({ ...settings, fidelizacion_niveles: nuevos });
                    }}
                    min={1}
                    className="w-32 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <span className="text-sm text-gray-600">→</span>
                  <input
                    type="number"
                    value={nivel.descuento}
                    onChange={(e) => {
                      const nuevos = [...settings.fidelizacion_niveles];
                      nuevos[i] = { ...nuevos[i], descuento: parseInt(e.target.value) || 0 };
                      setSettings({ ...settings, fidelizacion_niveles: nuevos });
                    }}
                    min={1}
                    max={100}
                    className="w-20 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <span className="text-sm text-gray-600">%</span>
                  <button
                    type="button"
                    onClick={() => {
                      const nuevos = settings.fidelizacion_niveles.filter((_, j) => j !== i);
                      setSettings({ ...settings, fidelizacion_niveles: nuevos });
                    }}
                    className="text-xs text-red-400 hover:text-red-600 ml-1"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
            {(settings.fidelizacion_niveles ?? []).length < 5 && (
              <button
                type="button"
                onClick={() => setSettings({
                  ...settings,
                  fidelizacion_niveles: [
                    ...(settings.fidelizacion_niveles ?? []),
                    { monto: 0, descuento: 0 },
                  ],
                })}
                className="text-sm text-green-600 hover:underline"
              >
                + Agregar nivel
              </button>
            )}
          </div>
        </section>

        {/* Licencia */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-700">Licencia</h2>
            {(computeLicenseStatus(settings)).isAutoBlocked && (
              <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-1 rounded-full">VENCIDA</span>
            )}
            {(computeLicenseStatus(settings)).isInWarningPeriod && (
              <span className="text-xs font-medium text-yellow-600 bg-yellow-50 px-2 py-1 rounded-full">Próximo a vencer</span>
            )}
            {!settings.license_end_date && (
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">Sin configurar</span>
            )}
            {settings.license_end_date && !(computeLicenseStatus(settings)).isAutoBlocked && !(computeLicenseStatus(settings)).isInWarningPeriod && (
              <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">Activa</span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="block text-gray-500 mb-1">Fecha de inicio</span>
              <span className="font-medium text-gray-800">
                {settings.license_start_date
                  ? new Date(settings.license_start_date).toLocaleDateString("es-CL")
                  : "—"}
              </span>
            </div>
            <div>
              <span className="block text-gray-500 mb-1">Fecha de término</span>
              <span className="font-medium text-gray-800">
                {settings.license_end_date
                  ? new Date(settings.license_end_date).toLocaleDateString("es-CL")
                  : "—"}
              </span>
            </div>
            <div>
              <span className="block text-gray-500 mb-1">Estado</span>
              <span className="font-medium text-gray-800">
                {!settings.license_end_date
                  ? "Sin configurar"
                  : (computeLicenseStatus(settings)).isAutoBlocked
                    ? "VENCIDA"
                    : (computeLicenseStatus(settings)).isInWarningPeriod
                      ? `${(computeLicenseStatus(settings)).daysUntilExpiry} días restantes`
                      : "Activa"}
              </span>
            </div>
          </div>
          {currentRole === "systemAdmin" && (
            <a
              href="/admin"
              className="inline-block mt-4 text-sm text-[#1a5f3f] hover:underline font-medium"
            >
              Ir a Administración para gestionar licencia →
            </a>
          )}
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
          {saved && <span className="text-sm text-green-600 font-medium">Guardado</span>}
        </div>
      </form>

      {/* Email Alerts section */}
      <div className="max-w-2xl mt-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Alertas de alimento</h2>
          <p className="text-sm text-gray-500 mb-4">
            Envía recordatorios por email a clientes cuyo alimento está próximo a agotarse.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSendAlerts}
              disabled={sendingAlerts}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {sendingAlerts ? "Enviando..." : "Enviar alertas pendientes"}
            </button>
            {alertsResult && (
              <span className="text-sm text-gray-600">
                {alertsResult.sent} enviadas · {alertsResult.skipped} omitidas
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
