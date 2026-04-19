"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface CanalConfig {
  id: string;
  canal_id: string;
  activo: boolean;
}

const CANALES = [
  {
    id: "pos",
    nombre: "Punto de Venta",
    descripcion: "Ventas directas en tienda física",
    color: "bg-green-500",
    icono: "🏪",
  },
  {
    id: "rappi",
    nombre: "Rappi",
    descripcion: "Entrega a domicilio y delivery",
    color: "bg-red-500",
    icono: "🛵",
  },
  {
    id: "pedidosya",
    nombre: "PedidosYa",
    descripcion: "Plataforma de delivery",
    color: "bg-yellow-500",
    icono: "📦",
  },
  {
    id: "ubereats",
    nombre: "Uber Eats",
    descripcion: "Delivery y pedidos online",
    color: "bg-black",
    icono: "🍔",
  },
];

export default function CanalesPage() {
  const router = useRouter();
  const [configs, setConfigs] = useState<CanalConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/canales/config")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setConfigs(d);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const getCanalActivo = (canalId: string): boolean => {
    if (canalId === "pos") return true;
    const config = configs.find((c) => c.canal_id === canalId);
    return config?.activo ?? false;
  };

  const isCanalConfigured = (canalId: string): boolean => {
    if (canalId === "pos") return true;
    return configs.some((c) => c.canal_id === canalId);
  };

  if (loading) return <div className="text-gray-500">Cargando...</div>;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">Canales de Venta</h1>
      <p className="text-gray-500 mb-8">
        Administra tus canales de venta multi-plataforma
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CANALES.map((canal) => {
          const configurado = isCanalConfigured(canal.id);
          const activo = getCanalActivo(canal.id);

          return (
            <div
              key={canal.id}
              className={`bg-white rounded-lg border p-6 transition-all ${
                activo
                  ? "border-green-200 ring-1 ring-green-200"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`w-12 h-12 rounded-lg ${canal.color} flex items-center justify-center text-xl`}
                >
                  {canal.icono}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-800">{canal.nombre}</h3>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        activo
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {activo ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{canal.descripcion}</p>

                  {!configurado && (
                    <button
                      onClick={() => router.push(`/canales/${canal.id}`)}
                      className="mt-3 text-sm text-green-600 hover:underline"
                    >
                      Configurar →
                    </button>
                  )}

                  {configurado && canal.id !== "pos" && (
                    <button
                      onClick={() => router.push(`/canales/${canal.id}`)}
                      className="mt-3 text-sm text-gray-500 hover:text-gray-700"
                    >
                      Ver configuración →
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 bg-gray-50 rounded-lg border border-gray-200 p-4">
        <h3 className="font-medium text-gray-700 mb-2">Acerca de los canales</h3>
        <ul className="text-sm text-gray-500 space-y-1">
          <li>• <strong>POS</strong>: Ventas directas en tienda (siempre activo)</li>
          <li>• <strong>Rappi</strong>: Integración completa con marketplace</li>
          <li>• <strong>PedidosYa</strong>: Sincronización de productos y pedidos</li>
          <li>• <strong>Uber Eats</strong>: Gestión de inventario y órdenes</li>
        </ul>
      </div>
    </div>
  );
}