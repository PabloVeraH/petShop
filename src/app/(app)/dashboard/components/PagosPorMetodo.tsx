import { etiquetaMetodo } from "@/lib/ventas/pagos";

export type PagoPorMetodo = { metodo: string; total: number; transacciones: number };

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

// Cobrado hoy por medio de pago (control diario). Lo calcula el servidor
// (/api/dashboard) con la misma regla que Reportes; aquí solo se muestra.
export default function PagosPorMetodo({ data }: { data?: PagoPorMetodo[] }) {
  if (!data) return null; // respuesta sin el campo: no inventar un $0
  const total = data.reduce((s, d) => s + d.total, 0);
  return (
    <section aria-labelledby="pagos-por-metodo" className="bg-white rounded-lg border border-gray-200 p-4">
      <h2 id="pagos-por-metodo" className="text-sm font-semibold text-gray-700 mb-3">Métodos de pago hoy</h2>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400">Sin ventas hoy</p>
      ) : (
        <>
          <ul className="space-y-2">
            {data.map((d) => (
              <li key={d.metodo}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-gray-600 truncate">
                    {etiquetaMetodo(d.metodo)} <span className="text-xs text-gray-400">({d.transacciones})</span>
                  </span>
                  <span className="font-medium text-gray-800 whitespace-nowrap">{pesos(d.total)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${total > 0 ? (d.total / total) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 pt-2 border-t border-gray-100 flex justify-between text-sm">
            <span className="text-gray-500">Total cobrado</span>
            <span className="font-bold text-gray-800">{pesos(total)}</span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Lo cobrado en las ventas de hoy, sin descontar devoluciones: puede ser mayor que &quot;Ventas hoy&quot;.
            Entre paréntesis, cuántas ventas usaron cada medio.
          </p>
        </>
      )}
    </section>
  );
}
