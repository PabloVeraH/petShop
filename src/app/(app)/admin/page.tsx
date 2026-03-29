"use client";

import { useEffect, useState } from "react";

type Store = {
  id: string;
  name: string;
  rut: string | null;
  email: string | null;
  phone: string | null;
  whatsapp_enabled: boolean;
  created_at: string;
  user_count: number;
};

export default function AdminPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/stores")
      .then((r) => {
        if (!r.ok) throw new Error("Acceso denegado");
        return r.json();
      })
      .then((d) => { setStores(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return <div className="text-gray-500 text-sm">Cargando...</div>;
  if (error) return <div className="text-red-500 text-sm">{error}</div>;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Administración del sistema</h1>

      <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Tiendas registradas</h2>
          <span className="text-xs text-gray-400">{stores.length} tienda{stores.length !== 1 ? "s" : ""}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="px-5 py-3 font-medium">Tienda</th>
              <th className="px-5 py-3 font-medium">RUT</th>
              <th className="px-5 py-3 font-medium">Contacto</th>
              <th className="px-5 py-3 font-medium text-center">Usuarios</th>
              <th className="px-5 py-3 font-medium text-center">WhatsApp</th>
              <th className="px-5 py-3 font-medium">Creada</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((s) => (
              <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-5 py-3 font-medium text-gray-800">{s.name}</td>
                <td className="px-5 py-3 text-gray-500">{s.rut ?? "—"}</td>
                <td className="px-5 py-3 text-gray-500">
                  <div>{s.email ?? "—"}</div>
                  {s.phone && <div className="text-xs text-gray-400">{s.phone}</div>}
                </td>
                <td className="px-5 py-3 text-center">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
                    {s.user_count}
                  </span>
                </td>
                <td className="px-5 py-3 text-center">
                  {s.whatsapp_enabled
                    ? <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Activo</span>
                    : <span className="text-xs text-gray-400">—</span>
                  }
                </td>
                <td className="px-5 py-3 text-gray-400 text-xs">
                  {new Date(s.created_at).toLocaleDateString("es-CL")}
                </td>
              </tr>
            ))}
            {stores.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-gray-400">Sin tiendas</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
