type VentaResumen = {
  id: string;
  total: number;
  created_at: string;
  clientes: { nombre: string } | null;
};

export default function UltimasVentas({ data }: { data: VentaResumen[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400 py-2">Sin ventas aún</p>;
  }

  return (
    <div className="space-y-2">
      {data.map((v) => (
        <div key={v.id} className="flex items-center justify-between text-sm">
          <div>
            <span className="font-medium">{v.clientes?.nombre ?? "Anónimo"}</span>
            <span className="text-xs text-gray-400 ml-2">
              {new Date(v.created_at).toLocaleTimeString("es-CL", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <span className="font-medium text-green-700">
            ${Math.round(Number(v.total)).toLocaleString("es-CL")}
          </span>
        </div>
      ))}
    </div>
  );
}
