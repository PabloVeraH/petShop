"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface ProductoAPI {
  sku: string;
  activo: boolean;
  categoria?: string;
}

export default function UberEatsCatalogoPage() {
  const router = useRouter();
  const [productos, setProductos] = useState<{ producto_id: string; activo: boolean; categoria?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);

  useEffect(() => {
    fetch("/api/productos")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProductos(
            data.map((p: ProductoAPI) => ({
              producto_id: p.sku,
              activo: p.activo,
              categoria: p.categoria,
            }))
          );
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleSync() {
    setSincronizando(true);
    try {
      const res = await fetch("/api/canales/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal_id: "ubereats" }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error ?? "Error sincronizando");
    } finally {
      setSincronizando(false);
    }
  }

  if (loading) return <div className="text-gray-500">Cargando...</div>;

  return (
    <div className="max-w-3xl">
      <button onClick={() => router.push("/canales")} className="text-sm text-gray-500 hover:text-gray-700 mb-4">
        ← Volver a Canales
      </button>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center text-lg">🍔</div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">Catálogo Uber Eats</h1>
            <p className="text-sm text-gray-500">Productos sincronizados</p>
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={sincronizando}
          className="px-4 py-2 bg-black text-white text-sm font-medium rounded-md hover:bg-gray-800 disabled:opacity-50"
        >
          {sincronizando ? "Sincronizando..." : "Sincronizar"}
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-500">SKU</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500">Activo</th>
            </tr>
          </thead>
          <tbody>
            {productos.map((p) => (
              <tr key={p.producto_id} className="border-b border-gray-100">
                <td className="px-4 py-2 text-gray-700">{p.producto_id}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${p.activo ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {p.activo ? "Activo" : "Inactivo"}
                  </span>
                </td>
              </tr>
            ))}
            {productos.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-gray-400">Sin productos</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}