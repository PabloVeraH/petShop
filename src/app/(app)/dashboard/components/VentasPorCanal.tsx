type Props = {
  data: { canal: string; total: number; transacciones: number }[];
};

const canalLabels: Record<string, { label: string; color: string }> = {
  pos: { label: "POS", color: "bg-green-500" },
  rappi: { label: "Rappi", color: "bg-red-500" },
  pedidosya: { label: "PedidosYa", color: "bg-yellow-500" },
  ubereats: { label: "Uber Eats", color: "bg-black" },
};

export default function VentasPorCanal({ data }: Props) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-400">Sin ventas hoy</p>;
  }

  return (
    <div className="space-y-3">
      {data.map((item) => {
        const info = canalLabels[item.canal] ?? { label: item.canal, color: "bg-gray-500" };
        return (
          <div key={item.canal} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${info.color}`} />
              <span className="text-sm text-gray-700">{info.label}</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-medium text-gray-800">
                ${item.total.toLocaleString("es-CL")}
              </span>
              <span className="text-xs text-gray-400 ml-2">
                ({item.transacciones} {item.transacciones === 1 ? "venta" : "ventas"})
              </span>
            </div>
          </div>
        );
      })}
      <div className="pt-2 border-t border-gray-100 flex justify-between">
        <span className="text-sm font-medium text-gray-700">Total</span>
        <span className="text-sm font-bold text-gray-800">
          ${data.reduce((sum, d) => sum + d.total, 0).toLocaleString("es-CL")}
        </span>
      </div>
    </div>
  );
}