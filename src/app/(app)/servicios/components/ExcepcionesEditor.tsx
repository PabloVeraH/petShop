"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Servicio, ServicioExcepcion } from "@/types";

interface Props {
  servicio: Servicio;
  onClose: () => void;
}

export function ExcepcionesEditor({ servicio, onClose }: Props) {
  const queryClient = useQueryClient();
  const [fecha, setFecha] = useState("");
  const [cerrado, setCerrado] = useState(true);
  const [horaInicio, setHoraInicio] = useState("09:00");
  const [horaFin, setHoraFin] = useState("18:00");
  const [error, setError] = useState("");

  const { data: excepciones = [], isLoading } = useQuery<ServicioExcepcion[]>({
    queryKey: ["excepciones", servicio.id],
    queryFn: () => fetch(`/api/servicios/${servicio.id}/excepciones`).then((r) => r.json()),
  });

  const { mutate: agregar, isPending: agregando } = useMutation({
    mutationFn: () =>
      fetch(`/api/servicios/${servicio.id}/excepciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha,
          cerrado,
          ...(cerrado ? {} : { hora_inicio: horaInicio, hora_fin: horaFin }),
        }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error al agregar");
        return d;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["excepciones", servicio.id] });
      queryClient.invalidateQueries({ queryKey: ["disponibilidad"] });
      setFecha("");
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const { mutate: eliminar } = useMutation({
    mutationFn: (excepcionId: string) =>
      fetch(`/api/servicios/${servicio.id}/excepciones/${excepcionId}`, { method: "DELETE" }).then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? "Error al eliminar");
        }
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["excepciones", servicio.id] });
      queryClient.invalidateQueries({ queryKey: ["disponibilidad"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg mx-4">
      <h3 className="text-base font-semibold text-gray-800 mb-1">
        Feriados y cierres — {servicio.nombre}
      </h3>
      <p className="text-xs text-gray-400 mb-4">
        Días puntuales que sobreescriben el horario semanal.
      </p>

      <div className="space-y-3 mb-4">
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Fecha</label>
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-40" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer pb-2">
            <input
              type="checkbox"
              checked={cerrado}
              onChange={(e) => setCerrado(e.target.checked)}
              className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
            />
            <span className="text-sm text-gray-700">Cerrado ese día</span>
          </label>
        </div>
        {!cerrado && (
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={horaInicio}
              onChange={(e) => setHoraInicio(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1 w-28"
            />
            <span className="text-xs text-gray-400">a</span>
            <input
              type="time"
              value={horaFin}
              onChange={(e) => setHoraFin(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1 w-28"
            />
            <span className="text-xs text-gray-400">(horario especial)</span>
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <Button
          onClick={() => agregar()}
          disabled={!fecha || agregando || (!cerrado && horaInicio >= horaFin)}
          className="w-full"
        >
          {agregando ? "Agregando..." : "Agregar excepción"}
        </Button>
      </div>

      <div className="border-t pt-3 max-h-56 overflow-y-auto">
        {isLoading && <p className="text-sm text-gray-400 text-center py-2">Cargando...</p>}
        {!isLoading && excepciones.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-2">Sin excepciones configuradas</p>
        )}
        {excepciones.map((e) => (
          <div key={e.id} className="flex items-center justify-between py-2 border-b last:border-0">
            <div>
              <p className="text-sm font-medium text-gray-800">{e.fecha}</p>
              <p className="text-xs text-gray-400">
                {e.cerrado ? "Cerrado" : `Horario especial: ${e.hora_inicio?.slice(0, 5)}–${e.hora_fin?.slice(0, 5)}`}
              </p>
            </div>
            <button onClick={() => eliminar(e.id)} className="text-xs text-red-400 hover:underline">
              Eliminar
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <Button variant="outline" onClick={onClose} className="w-full">Cerrar</Button>
      </div>
    </div>
  );
}
