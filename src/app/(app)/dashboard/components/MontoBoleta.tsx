import { etiquetaMetodo } from "@/lib/ventas/pagos";

// Total a boletear del período (Res. Ex. SII 176/2020): lo cobrado en el POS
// que no cubre el voucher Transbank. Lo calcula el servidor (/api/reports,
// /api/dashboard); aquí solo se muestra.
export default function MontoBoleta({ monto, porMetodo }: { monto?: number; porMetodo?: Record<string, number> }) {
  if (monto === undefined) return null; // respuesta sin el campo: no inventar un $0
  const desglose = Object.entries(porMetodo ?? {}).filter(([, v]) => v > 0);
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">A boletear (no cubierto por voucher)</p>
      <p className="text-xl font-bold text-gray-800">${Math.round(monto).toLocaleString("es-CL")}</p>
      {desglose.length === 0 ? (
        <p className="text-xs text-gray-400 mt-0.5">Sin montos a boletear</p>
      ) : (
        <ul className="text-xs text-gray-500 mt-1 space-y-0.5">
          {desglose.map(([metodo, v]) => (
            <li key={metodo}>
              {etiquetaMetodo(metodo)}: ${Math.round(v).toLocaleString("es-CL")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
