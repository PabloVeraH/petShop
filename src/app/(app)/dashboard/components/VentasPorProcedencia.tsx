type Props = {
  data: { procedencia: string; total: number; transacciones: number }[];
};

const PROCEDENCIA_CONFIG: Record<string, { label: string; color: string; hex: string }> = {
  presencial: { label: "Presencial", color: "bg-green-500",   hex: "#22c55e" },
  instagram:  { label: "Instagram",  color: "bg-pink-500",    hex: "#ec4899" },
  whatsapp:   { label: "WhatsApp",   color: "bg-emerald-500", hex: "#10b981" },
  facebook:   { label: "Facebook",   color: "bg-blue-600",    hex: "#2563eb" },
  tiktok:     { label: "TikTok",     color: "bg-gray-900",    hex: "#111827" },
  telefonico: { label: "Telefónico", color: "bg-amber-500",   hex: "#f59e0b" },
};

// SVG donut chart — circumference ≈ 100 when r = 15.9154943
const RADIUS = 15.9154943;
const CIRC = 2 * Math.PI * RADIUS; // ≈ 100

export default function VentasPorProcedencia({ data }: Props) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-400">Sin ventas hoy</p>;
  }

  const total = data.reduce((s, d) => s + d.total, 0);
  const sorted = [...data].sort((a, b) => b.total - a.total);

  // Build donut segments
  let cumulative = 0;
  const segments = sorted.map((item) => {
    const pct = total > 0 ? (item.total / total) * 100 : 0;
    const offset = CIRC - (cumulative / 100) * CIRC;
    const dash = (pct / 100) * CIRC;
    const gap = CIRC - dash;
    cumulative += pct;
    const cfg = PROCEDENCIA_CONFIG[item.procedencia] ?? { hex: "#9ca3af", label: item.procedencia };
    return { ...item, pct, dash, gap, offset, hex: cfg.hex };
  });

  return (
    <div className="flex gap-4 items-center">
      {/* Donut */}
      <div className="shrink-0">
        <svg width="80" height="80" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r={RADIUS} fill="none" stroke="#f3f4f6" strokeWidth="4" />
          {segments.map((seg, i) => (
            <circle
              key={i}
              cx="20"
              cy="20"
              r={RADIUS}
              fill="none"
              stroke={seg.hex}
              strokeWidth="4"
              strokeDasharray={`${seg.dash} ${seg.gap}`}
              strokeDashoffset={seg.offset}
              style={{ transform: "rotate(-90deg)", transformOrigin: "20px 20px" }}
            />
          ))}
        </svg>
      </div>

      {/* Leyenda */}
      <div className="flex-1 space-y-1.5 min-w-0">
        {sorted.map((item) => {
          const cfg = PROCEDENCIA_CONFIG[item.procedencia] ?? { label: item.procedencia, color: "bg-gray-400" };
          const pct = total > 0 ? Math.round((item.total / total) * 100) : 0;
          return (
            <div key={item.procedencia} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.color}`} />
                <span className="text-xs text-gray-600 truncate">{cfg.label}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs font-medium text-gray-700">{pct}%</span>
                <span className="text-xs text-gray-400">
                  ({item.transacciones})
                </span>
              </div>
            </div>
          );
        })}
        <div className="pt-1 border-t border-gray-100 flex justify-between">
          <span className="text-xs text-gray-500">Total</span>
          <span className="text-xs font-bold text-gray-700">
            ${Math.round(total).toLocaleString("es-CL")}
          </span>
        </div>
      </div>
    </div>
  );
}
