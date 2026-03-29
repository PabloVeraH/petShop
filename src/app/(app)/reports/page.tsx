"use client";

import { useState, useEffect } from "react";

interface ReportsData {
  periodo: number;
  totalPeriodo: number;
  totalTransacciones: number;
  ticketPromedio: number;
  ventasPorDia: [string, number][];
  topProductos: { nombre: string; cantidad: number; revenue: number }[];
  topClientes: { nombre: string; total: number; compras: number }[];
  metodos: Record<string, number>;
  prediccion7dias: number;
  promedioDiario: number;
}

const PERIODOS = [
  { label: "7 días", value: "7" },
  { label: "30 días", value: "30" },
  { label: "90 días", value: "90" },
];

function fmt(n: number) {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function BarChart({ data, color = "bg-green-500" }: {
  data: { label: string; value: number }[];
  color?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-28 shrink-0 truncate text-right">{d.label}</span>
          <div className="flex-1 bg-gray-100 rounded h-5 overflow-hidden">
            <div
              className={`h-full ${color} rounded transition-all`}
              style={{ width: `${(d.value / max) * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-700 w-24 shrink-0">{fmt(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

function DayChart({ data }: { data: [string, number][] }) {
  const max = Math.max(...data.map(([, v]) => v), 1);
  return (
    <div className="flex items-end gap-1 h-28">
      {data.map(([day, val], i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${day}: ${fmt(val)}`}>
          <div
            className="w-full bg-green-500 rounded-t"
            style={{ height: `${Math.max((val / max) * 96, 2)}px` }}
          />
          <span className="text-[9px] text-gray-400 writing-mode-vertical">
            {day.slice(5)}
          </span>
        </div>
      ))}
      {data.length === 0 && (
        <div className="w-full text-center text-xs text-gray-400 self-center">Sin datos</div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const [periodo, setPeriodo] = useState("30");
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"ventas" | "inventario" | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports?periodo=${periodo}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, [periodo]);

  async function handleExport(tipo: "ventas" | "inventario") {
    setExporting(tipo);
    const url = `/api/reports/export?tipo=${tipo}`;
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${tipo}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    setExporting(null);
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Reportes</h1>
        <div className="flex items-center gap-3">
          <div className="flex border border-gray-200 rounded-md overflow-hidden">
            {PERIODOS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriodo(p.value)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  periodo === p.value
                    ? "bg-green-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => handleExport("ventas")}
            disabled={exporting === "ventas"}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting === "ventas" ? "Exportando..." : "↓ Ventas CSV"}
          </button>
          <button
            onClick={() => handleExport("inventario")}
            disabled={exporting === "inventario"}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting === "inventario" ? "Exportando..." : "↓ Inventario CSV"}
          </button>
        </div>
      </div>

      {loading && <div className="text-gray-500">Cargando...</div>}

      {data && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Total período", value: fmt(data.totalPeriodo) },
              { label: "Transacciones", value: data.totalTransacciones.toLocaleString("es-CL") },
              { label: "Ticket promedio", value: fmt(data.ticketPromedio) },
              { label: "Predicción 7 días", value: fmt(data.prediccion7dias), sub: `~${fmt(data.promedioDiario)}/día` },
            ].map((kpi) => (
              <div key={kpi.label} className="bg-white rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500 mb-1">{kpi.label}</p>
                <p className="text-xl font-bold text-gray-800">{kpi.value}</p>
                {kpi.sub && <p className="text-xs text-gray-400 mt-0.5">{kpi.sub}</p>}
              </div>
            ))}
          </div>

          {/* Ventas por día */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Ventas por día</h2>
            <DayChart data={data.ventasPorDia} />
          </div>

          {/* Top productos + Métodos de pago */}
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Top 10 productos (por ingresos)</h2>
              <BarChart
                data={data.topProductos.map((p) => ({ label: p.nombre, value: p.revenue }))}
                color="bg-green-500"
              />
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Métodos de pago</h2>
              <BarChart
                data={Object.entries(data.metodos).map(([k, v]) => ({ label: k, value: v }))}
                color="bg-blue-500"
              />
              <div className="mt-4 space-y-1">
                {Object.entries(data.metodos).map(([metodo, total]) => (
                  <div key={metodo} className="flex justify-between text-xs text-gray-600">
                    <span className="capitalize">{metodo}</span>
                    <span>{fmt(total)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Top clientes */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Top 10 clientes</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="pb-2 font-medium">#</th>
                    <th className="pb-2 font-medium">Cliente</th>
                    <th className="pb-2 font-medium text-right">Compras</th>
                    <th className="pb-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topClientes.map((c, i) => (
                    <tr key={c.nombre} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 text-gray-400 text-xs">{i + 1}</td>
                      <td className="py-2 font-medium text-gray-700">{c.nombre}</td>
                      <td className="py-2 text-right text-gray-500">{c.compras}</td>
                      <td className="py-2 text-right font-medium text-gray-700">{fmt(c.total)}</td>
                    </tr>
                  ))}
                  {data.topClientes.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-gray-400">Sin datos</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
