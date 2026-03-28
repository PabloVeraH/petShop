import { differenceInDays } from "date-fns";

type Alerta = {
  id: string;
  fecha_estimada_termino: string;
  mascotas: { nombre: string } | null;
  productos: { nombre: string } | null;
  clientes: { nombre: string } | null;
};

export default function AlertasConsumo({ data }: { data: Alerta[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400">Sin alertas de consumo</p>;
  }

  return (
    <div className="space-y-2">
      {data.map((a) => {
        const dias = differenceInDays(new Date(a.fecha_estimada_termino), new Date());
        return (
          <div
            key={a.id}
            className="flex items-center justify-between rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium">
                {a.mascotas?.nombre} · {a.clientes?.nombre}
              </p>
              <p className="text-xs text-gray-500">{a.productos?.nombre}</p>
            </div>
            <span
              className={`text-sm font-bold ${dias <= 3 ? "text-red-600" : "text-yellow-700"}`}
            >
              {dias <= 0 ? "Agotado" : `${dias}d`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
