"use client";

import Link from "next/link";

type Sugerencia = {
  producto_nombre: string;
  sku: string;
  stock_actual: number;
  dias_restantes: number;
  mascota_nombre?: string;
  cliente_nombre?: string;
  urgente: boolean;
  proveedores: Array<{ id?: string; nombre: string; costo: number | null; tiempo_entrega_dias: number }>;
};

export default function SugerenciasRecompra({ data }: { data: Sugerencia[] }) {
  if (!data.length) {
    return <p className="text-xs text-gray-400">Sin sugerencias de recompra</p>;
  }

  return (
    <div className="space-y-2">
      {data.map((s, i) => (
        <div key={i} className={`rounded px-3 py-2 text-sm ${s.urgente ? "bg-red-50 border border-red-200" : "bg-yellow-50 border border-yellow-100"}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="font-medium">{s.producto_nombre}</span>
              {s.mascota_nombre && (
                <span className="text-xs text-gray-500 ml-2">para {s.mascota_nombre} ({s.cliente_nombre})</span>
              )}
              <div className="text-xs mt-0.5">
                <span className={s.urgente ? "text-red-600 font-medium" : "text-yellow-700"}>
                  {s.dias_restantes <= 0 ? "¡Agotado!" : `${s.dias_restantes} días restantes`}
                </span>
                <span className="text-gray-400 ml-2">· Stock: {s.stock_actual}</span>
              </div>
            </div>
            <Link href="/purchases">
              <span className="text-xs text-blue-500 hover:underline whitespace-nowrap">+ OC</span>
            </Link>
          </div>
          {s.proveedores.length > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              Proveedor: {s.proveedores[0].nombre}
              {s.proveedores[0].costo ? ` · $${Number(s.proveedores[0].costo).toLocaleString("es-CL")}` : ""}
              {` · ${s.proveedores[0].tiempo_entrega_dias}d entrega`}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
