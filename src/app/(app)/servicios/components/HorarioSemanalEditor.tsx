"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { Servicio, ServicioConHorarios, ServicioHorario, DiaSemana } from "@/types";

const DIAS: { label: string; value: DiaSemana }[] = [
  { label: "Lunes", value: 1 },
  { label: "Martes", value: 2 },
  { label: "Miércoles", value: 3 },
  { label: "Jueves", value: 4 },
  { label: "Viernes", value: 5 },
  { label: "Sábado", value: 6 },
  { label: "Domingo", value: 7 },
];

function formatHora(value: string): string {
  // Postgres TIME serializa como "HH:MM:SS" (inferido, no verificado contra instancia real);
  // recortamos a "HH:MM" para input type=time.
  return value.slice(0, 5);
}

type Slot = { habilitado: boolean; hora_inicio: string; hora_fin: string };
type SlotMap = Record<number, Slot>;

function inicializarSlots(horarios: ServicioHorario[]): SlotMap {
  const map: SlotMap = {};
  for (const h of horarios) {
    map[h.dia_semana] = { habilitado: true, hora_inicio: formatHora(h.hora_inicio), hora_fin: formatHora(h.hora_fin) };
  }
  return map;
}

interface FormProps {
  servicio: Servicio;
  horarios: ServicioHorario[];
  onClose: () => void;
}

function FranjasEditor({ servicio, horarios, onClose }: FormProps) {
  const queryClient = useQueryClient();
  const [slots, setSlots] = useState<SlotMap>(() => inicializarSlots(horarios));

  const { mutate: guardar, isPending } = useMutation({
    mutationFn: () => {
      const franjas = DIAS
        .filter((d) => slots[d.value]?.habilitado)
        .map((d) => ({
          dia_semana: d.value,
          hora_inicio: slots[d.value]!.hora_inicio || "09:00",
          hora_fin: slots[d.value]!.hora_fin || "18:00",
        }));
      return fetch(`/api/servicios/${servicio.id}/horarios`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horarios: franjas }),
      }).then(async (r) => {
        if (!r.ok) {
          const d = await r.json();
          throw new Error(d.error ?? "Error al guardar");
        }
        return r.json();
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servicios"] });
      queryClient.invalidateQueries({ queryKey: ["servicios", servicio.id] });
      onClose();
    },
    onError: (e: Error) => alert(e.message),
  });

  function toggleDia(dia: DiaSemana) {
    setSlots((prev) => {
      const next = { ...prev };
      if (next[dia]?.habilitado) {
        next[dia] = { ...next[dia], habilitado: false };
      } else {
        next[dia] = { habilitado: true, hora_inicio: "09:00", hora_fin: "18:00" };
      }
      return next;
    });
  }

  function updateHora(dia: DiaSemana, field: "hora_inicio" | "hora_fin", value: string) {
    setSlots((prev) => {
      const current = prev[dia];
      if (!current?.habilitado) return prev;
      return { ...prev, [dia]: { ...current, [field]: value } };
    });
  }

  return (
    <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg mx-4">
      <h3 className="text-base font-semibold text-gray-800 mb-1">
        Horario semanal — {servicio.nombre}
      </h3>
      <p className="text-xs text-gray-400 mb-3">
        {servicio.duracion_minutos} minutos por turno
      </p>

      <div className="space-y-2 mb-4">
        {DIAS.map((d) => {
          const slot = slots[d.value];
          const hab = slot?.habilitado;
          return (
            <div key={d.value} className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer min-w-[90px]">
                <input
                  type="checkbox"
                  checked={!!hab}
                  onChange={() => toggleDia(d.value)}
                  className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                />
                <span className="text-sm text-gray-700">{d.label}</span>
              </label>
              {hab && (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={slot.hora_inicio}
                    onChange={(e) => updateHora(d.value, "hora_inicio", e.target.value)}
                    className="text-sm border border-gray-300 rounded px-2 py-1 w-28"
                  />
                  <span className="text-xs text-gray-400">a</span>
                  <input
                    type="time"
                    value={slot.hora_fin}
                    onChange={(e) => updateHora(d.value, "hora_fin", e.target.value)}
                    className="text-sm border border-gray-300 rounded px-2 py-1 w-28"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
        <Button onClick={() => guardar()} disabled={isPending} className="flex-1">
          {isPending ? "Guardando..." : "Guardar horario"}
        </Button>
      </div>
    </div>
  );
}

export function HorarioSemanalEditor({ servicio, onClose }: { servicio: Servicio; onClose: () => void }) {
  const { data, isLoading } = useQuery<ServicioConHorarios>({
    queryKey: ["servicios", servicio.id],
    queryFn: () => fetch(`/api/servicios/${servicio.id}`).then((r) => r.json()),
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg mx-4">
        <p className="text-sm text-gray-400 text-center py-4">Cargando...</p>
      </div>
    );
  }

  // key={servicio.id} fuerza re-montaje limpio del formulario al cambiar de servicio.
  const horarios = data?.servicio_horarios ?? [];
  return <FranjasEditor key={servicio.id} servicio={servicio} horarios={horarios} onClose={onClose} />;
}