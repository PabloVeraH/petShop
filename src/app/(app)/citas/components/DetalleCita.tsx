"use client";

import { Button } from "@/components/ui/button";
import type { Cita, CitaEstado } from "@/types";
import { formatFechaHora } from "./date-utils";

const COLOR_ESTADO: Record<CitaEstado, string> = {
  confirmada: "bg-green-100 text-green-700",
  completada: "bg-blue-100 text-blue-700",
  cancelada: "bg-gray-100 text-gray-500",
  no_show: "bg-orange-100 text-orange-700",
};

const ETIQUETA_ESTADO: Record<CitaEstado, string> = {
  confirmada: "Confirmada",
  completada: "Completada",
  cancelada: "Cancelada",
  no_show: "No show",
};

interface Props {
  cita: Cita;
  onClose: () => void;
}

// Detalle completo de una cita (ticket 6a7160fe621dcf1dba95b92f): el listado
// solo mostraba un resumen sin forma de ver el detalle, y el campo cancelado_at
// (fecha de cancelación) nunca se desplegaba en la UI aunque el backend lo
// guarda. Muestra estado, motivo y fecha de cancelación para citas canceladas,
// además del resto de los datos que el listado trunca (notas, venta, etc.).
export function DetalleCita({ cita, onClose }: Props) {
  const cancelada = cita.estado === "cancelada";

  return (
    <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-gray-800">Detalle de cita</h3>
        <span className={`text-xs px-2 py-0.5 rounded ${COLOR_ESTADO[cita.estado]}`}>
          {ETIQUETA_ESTADO[cita.estado]}
        </span>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-gray-400 shrink-0">Fecha y hora</dt>
          <dd className="text-right text-gray-800">
            {cita.fecha} · {cita.hora_inicio.slice(0, 5)}–{cita.hora_fin.slice(0, 5)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-400 shrink-0">Cliente</dt>
          <dd className="text-right text-gray-800">
            {cita.cliente?.nombre ?? "—"}
            {cita.cliente?.telefono ? ` · ${cita.cliente.telefono}` : ""}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-400 shrink-0">Mascota</dt>
          <dd className="text-right text-gray-800">{cita.mascota?.nombre ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-400 shrink-0">Servicio</dt>
          <dd className="text-right text-gray-800">
            {cita.servicio?.nombre ?? "—"} · {cita.duracion_minutos} min
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-400 shrink-0">Encargado</dt>
          <dd className="text-right text-gray-800">{cita.encargado?.nombre ?? "Sin asignar"}</dd>
        </div>
        {cita.precio != null && (
          <div className="flex justify-between gap-4">
            <dt className="text-gray-400 shrink-0">Precio</dt>
            <dd className="text-right text-gray-800">${Number(cita.precio).toLocaleString("es-CL")}</dd>
          </div>
        )}
        {cita.venta_id && (
          <div className="flex justify-between gap-4">
            <dt className="text-gray-400 shrink-0">Venta</dt>
            <dd className="text-right text-gray-800">#{cita.venta_id.slice(0, 8)}…</dd>
          </div>
        )}
        {cita.notas && (
          <div className="flex justify-between gap-4">
            <dt className="text-gray-400 shrink-0">Notas</dt>
            <dd className="text-right text-gray-800 italic">{cita.notas}</dd>
          </div>
        )}
        {cancelada && (
          <div className="border-t pt-2 mt-2 space-y-2">
            <div className="flex justify-between gap-4">
              <dt className="text-gray-400 shrink-0">Motivo</dt>
              <dd className="text-right text-red-500">{cita.motivo_cancelacion ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-400 shrink-0">Cancelada el</dt>
              <dd className="text-right text-gray-800">{formatFechaHora(cita.cancelado_at)}</dd>
            </div>
          </div>
        )}
      </dl>

      <div className="mt-5">
        <Button variant="outline" onClick={onClose} className="w-full">Cerrar</Button>
      </div>
    </div>
  );
}
