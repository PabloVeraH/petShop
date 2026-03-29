"use client";

import { useState, useEffect } from "react";

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
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

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
    </div>
  );
}
