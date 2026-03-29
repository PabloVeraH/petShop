import Link from "next/link";

type VentaResumen = {
  id: string;
  total: number;
  estado: string;
  created_at: string;
  clientes: { nombre: string } | null;
};

export default function UltimasVentas({ data }: { data: VentaResumen[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400 py-2">Sin ventas aún</p>;
  }

  return (
    <div className="space-y-2">
      {data.map((v) => {
        const anulada = v.estado === "anulada";
        const cliente = v.clientes as unknown as { nombre: string } | null;
        return (
          <div key={v.id} className="flex items-center justify-between text-sm">
            <div>
              <span className={`font-medium ${anulada ? "text-gray-400 line-through" : ""}`}>
                {cliente?.nombre ?? "Anónimo"}
              </span>
              <span className="text-xs text-gray-400 ml-2">
                {new Date(v.created_at).toLocaleTimeString("es-CL", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              {anulada && (
                <span className="ml-2 text-xs font-medium text-red-500 bg-red-50 px-1.5 py-0.5 rounded">
                  Anulada
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={`font-medium ${anulada ? "text-gray-400 line-through" : "text-green-700"}`}>
                ${Math.round(Number(v.total)).toLocaleString("es-CL")}
              </span>
              <Link href={`/sales/${v.id}`} className="text-xs text-blue-400 hover:underline">
                →
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
