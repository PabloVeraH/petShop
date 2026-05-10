"use client";

import { useState, useEffect } from "react";

interface ReportsData {
  periodo: number;
  totalPeriodo: number;
  totalTransacciones: number;
  ticketPromedio: number;
  ventasPorDia: [string, { total: number; transacciones: number }][];
  topProductos: { nombre: string; cantidad: number; revenue: number }[];
  topClientes: { nombre: string; total: number; compras: number }[];
  metodos: Record<string, number>;
  canales: Record<string, { total: number; transacciones: number }>;
  procedencias: Record<string, { total: number; transacciones: number }>;
  prediccion7dias: number;
  promedioDiario: number;
}

const PERIODOS = [
  { label: "7 días", value: "7" },
  { label: "30 días", value: "30" },
  { label: "90 días", value: "90" },
];

const CANALES = [
  { label: "Todos", value: "" },
  { label: "POS", value: "pos" },
  { label: "Rappi", value: "rappi" },
  { label: "PedidosYa", value: "pedidosya" },
  { label: "Uber Eats", value: "ubereats" },
];

const PROCEDENCIA_LABELS: Record<string, { label: string; color: string; hex: string }> = {
  presencial: { label: "Presencial", color: "bg-green-500",   hex: "#22c55e" },
  instagram:  { label: "Instagram",  color: "bg-pink-500",    hex: "#ec4899" },
  whatsapp:   { label: "WhatsApp",   color: "bg-emerald-500", hex: "#10b981" },
  facebook:   { label: "Facebook",   color: "bg-blue-600",    hex: "#2563eb" },
  tiktok:     { label: "TikTok",     color: "bg-gray-900",    hex: "#111827" },
  telefonico: { label: "Telefónico", color: "bg-amber-500",   hex: "#f59e0b" },
};

const CANAL_LABELS: Record<string, { label: string; hex: string }> = {
  pos:       { label: "POS",       hex: "#8b5cf6" },
  rappi:     { label: "Rappi",     hex: "#f97316" },
  pedidosya: { label: "PedidosYa", hex: "#ef4444" },
  ubereats:  { label: "Uber Eats", hex: "#16a34a" },
};

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

interface PieSlice {
  key: string;
  label: string;
  hex: string;
  value: number;
  tooltipLines: string[];
}

function PieChart({ slices }: { slices: PieSlice[] }) {
  const [tooltip, setTooltip] = useState<{ slice: PieSlice; x: number; y: number } | null>(null);

  const totalAll = slices.reduce((s, p) => s + p.value, 0);
  if (totalAll === 0 || slices.length === 0)
    return <div className="text-xs text-gray-400">Sin datos</div>;

  const cx = 120, cy = 120, r = 105;
  let angle = -Math.PI / 2;

  const paths = slices.map((s) => {
    const pct = Math.round((s.value / totalAll) * 100);
    const sweep = (s.value / totalAll) * 2 * Math.PI;
    const capped = sweep >= 2 * Math.PI - 0.001 ? 2 * Math.PI - 0.001 : sweep;
    const start = angle;
    const end = angle + capped;
    angle += sweep;

    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const largeArc = capped > Math.PI ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;

    const mid = (start + end) / 2;
    const lx = cx + r * 0.62 * Math.cos(mid);
    const ly = cy + r * 0.62 * Math.sin(mid);

    return { ...s, d, lx, ly, pct };
  });

  return (
    <div className="flex flex-col sm:flex-row gap-6 items-center">
      <div className="shrink-0">
        <svg width="240" height="240" viewBox="0 0 240 240">
          {paths.map((p) => (
            <path
              key={p.key}
              d={p.d}
              fill={p.hex}
              stroke="white"
              strokeWidth="2"
              className="cursor-pointer transition-opacity hover:opacity-80"
              onMouseEnter={(e) => setTooltip({ slice: p, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : null))}
              onMouseLeave={() => setTooltip(null)}
            />
          ))}
          {paths.map((p) =>
            p.pct >= 5 ? (
              <text
                key={`lbl-${p.key}`}
                x={p.lx}
                y={p.ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="12"
                fontWeight="bold"
                fill="white"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {p.pct}%
              </text>
            ) : null,
          )}
        </svg>
      </div>

      <div className="flex flex-col gap-2">
        {paths.map((p) => (
          <div key={p.key} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: p.hex }} />
            <p className="text-sm text-gray-700">{p.label}</p>
          </div>
        ))}
      </div>

      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-gray-900 text-white rounded-lg px-3 py-2 text-xs shadow-xl"
          style={{ left: tooltip.x + 14, top: tooltip.y - 14 }}
        >
          <p className="font-semibold">{tooltip.slice.label}</p>
          {tooltip.slice.tooltipLines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function DayChart({ data }: { data: [string, { total: number; transacciones: number }][] }) {
  const [tooltip, setTooltip] = useState<{
    day: string; total: number; transacciones: number; x: number; y: number;
  } | null>(null);

  if (data.length === 0)
    return <div className="text-xs text-gray-400 text-center py-8">Sin datos</div>;

  const VW = 600, VH = 130;
  const padL = 8, padR = 8, padT = 22, padB = 22;
  const innerW = VW - padL - padR;
  const innerH = VH - padT - padB;

  const maxTotal = Math.max(...data.map(([, v]) => v.total), 1);
  const maxTx    = Math.max(...data.map(([, v]) => v.transacciones), 1);
  const colW     = innerW / data.length;
  const gap      = colW * 0.25;

  const cols = data.map(([day, val], i) => ({
    day,
    total: val.total,
    transacciones: val.transacciones,
    bh:   Math.max((val.total / maxTotal) * innerH, val.total > 0 ? 2 : 0),
    dotX: padL + i * colW + colW / 2,
    dotY: padT + innerH - (val.transacciones / maxTx) * innerH,
    i,
  }));

  return (
    <>
      <div className="flex gap-4 mb-2 text-xs text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-green-500 inline-block" />
          Monto
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-blue-400 inline-block rounded-full" />
          <span className="w-2 h-2 rounded-full border-2 border-blue-400 bg-white inline-block" />
          N° ventas
        </span>
      </div>

      <div className="relative w-full">
        <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" style={{ height: "140px" }}>
          {/* Bars (monto) */}
          {cols.map((c) => (
            <rect
              key={`bar-${c.i}`}
              x={padL + c.i * colW + gap / 2}
              y={padT + innerH - c.bh}
              width={colW - gap}
              height={c.bh}
              rx="2"
              fill="#22c55e"
              opacity={tooltip?.day === c.day ? 0.7 : 1}
            />
          ))}

          {/* Invisible hit areas covering full column */}
          {cols.map((c) => (
            <rect
              key={`hit-${c.i}`}
              x={padL + c.i * colW}
              y={padT}
              width={colW}
              height={innerH}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={(e) =>
                setTooltip({ day: c.day, total: c.total, transacciones: c.transacciones, x: e.clientX, y: e.clientY })
              }
              onMouseMove={(e) =>
                setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : null))
              }
              onMouseLeave={() => setTooltip(null)}
            />
          ))}

          {/* Line (transacciones) */}
          {cols.length > 1 && (
            <polyline
              points={cols.map((c) => `${c.dotX},${c.dotY}`).join(" ")}
              fill="none"
              stroke="#60a5fa"
              strokeWidth="1.5"
              strokeLinejoin="round"
              style={{ pointerEvents: "none" }}
            />
          )}

          {/* Dots */}
          {cols.map((c) => (
            <circle
              key={`dot-${c.i}`}
              cx={c.dotX}
              cy={c.dotY}
              r="4"
              fill="white"
              stroke="#60a5fa"
              strokeWidth="2"
              style={{ pointerEvents: "none" }}
            />
          ))}

          {/* Count labels above each dot */}
          {cols.map((c) => (
            <text
              key={`lbl-${c.i}`}
              x={c.dotX}
              y={c.dotY - 7}
              textAnchor="middle"
              fontSize="9"
              fontWeight="600"
              fill="#60a5fa"
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {c.transacciones}
            </text>
          ))}

          {/* Day labels */}
          {cols.map((c) => (
            <text
              key={`day-${c.i}`}
              x={c.dotX}
              y={VH - 4}
              textAnchor="middle"
              fontSize="9"
              fill="#9ca3af"
              style={{ pointerEvents: "none" }}
            >
              {c.day.slice(5)}
            </text>
          ))}
        </svg>

        {tooltip && (
          <div
            className="fixed z-50 pointer-events-none bg-gray-900 text-white rounded-lg px-3 py-2 text-xs shadow-xl"
            style={{ left: tooltip.x + 14, top: tooltip.y - 14 }}
          >
            <p className="font-semibold">{tooltip.day}</p>
            <p>{fmt(tooltip.total)}</p>
            <p>{tooltip.transacciones} venta{tooltip.transacciones !== 1 ? "s" : ""}</p>
          </div>
        )}
      </div>
    </>
  );
}

export default function ReportesTab() {
  const [periodo, setPeriodo] = useState("30");
  const [canal, setCanal] = useState("");
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"ventas" | "inventario" | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ periodo });
    if (canal) params.set("canal", canal);
    fetch(`/api/reports?${params}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, [periodo, canal]);

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
        <div className="flex items-center gap-3">
          <select
            value={canal}
            onChange={(e) => setCanal(e.target.value)}
            className="border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-700 bg-white"
          >
            {CANALES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
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
              { label: "Total Ventas período", value: fmt(data.totalPeriodo) },
              { label: "Cantidad de Ventas", value: data.totalTransacciones.toLocaleString("es-CL") },
              { label: "Venta promedio de Venta", value: fmt(data.ticketPromedio) },
              { label: "Predicción prox. 7 días", value: fmt(data.prediccion7dias), sub: `~${fmt(data.promedioDiario)}/día` },
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
            </div>
          </div>

          {/* Ventas por canal + Procedencia */}
          {((data.canales && Object.keys(data.canales).length > 0) ||
            (data.procedencias && Object.keys(data.procedencias).length > 0)) && (
            <div className="grid grid-cols-2 gap-6">
              {data.canales && Object.keys(data.canales).length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-5">
                  <h2 className="text-sm font-semibold text-gray-700 mb-4">Ventas por canal</h2>
                  <PieChart
                    slices={Object.entries(data.canales)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([k, v]) => ({
                        key: k,
                        label: CANAL_LABELS[k]?.label ?? k,
                        hex: CANAL_LABELS[k]?.hex ?? "#9ca3af",
                        value: v.total,
                        tooltipLines: [
                          fmt(v.total),
                          `${v.transacciones} venta${v.transacciones !== 1 ? "s" : ""}`,
                        ],
                      }))}
                  />
                </div>
              )}
              {data.procedencias && Object.keys(data.procedencias).length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-5">
                  <h2 className="text-sm font-semibold text-gray-700 mb-4">Procedencia de ventas</h2>
                  <PieChart
                    slices={Object.entries(data.procedencias)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([k, v]) => ({
                        key: k,
                        label: PROCEDENCIA_LABELS[k]?.label ?? k,
                        hex: PROCEDENCIA_LABELS[k]?.hex ?? "#9ca3af",
                        value: v.total,
                        tooltipLines: [
                          fmt(v.total),
                          `${v.transacciones} venta${v.transacciones !== 1 ? "s" : ""}`,
                        ],
                      }))}
                  />
                </div>
              )}
            </div>
          )}

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