"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { NuevaCitaForm } from "./NuevaCitaForm";
import ModalCobroCita from "./ModalCobroCita";
import { DetalleCita } from "./DetalleCita";
import { hoyLocal, formatFechaHora } from "./date-utils";
import type { Cita, CitaEstado, Encargado, Servicio } from "@/types";

const ESTADOS: { value: CitaEstado | ""; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "confirmada", label: "Confirmada" },
  { value: "completada", label: "Completada" },
  { value: "cancelada", label: "Cancelada" },
  { value: "no_show", label: "No show" },
];

const COLOR_ESTADO: Record<CitaEstado, string> = {
  confirmada: "bg-green-100 text-green-700",
  completada: "bg-blue-100 text-blue-700",
  cancelada: "bg-gray-100 text-gray-500",
  no_show: "bg-orange-100 text-orange-700",
};

export function CitasTab() {
  const queryClient = useQueryClient();
  const [fecha, setFecha] = useState(hoyLocal());
  const [servicioId, setServicioId] = useState("");
  const [encargadoId, setEncargadoId] = useState("");
  const [estado, setEstado] = useState<CitaEstado | "">("");
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [cobrando, setCobrando] = useState<Cita | null>(null);
  const [detalleCita, setDetalleCita] = useState<Cita | null>(null);
  const [error, setError] = useState("");

  const { data: servicios = [] } = useQuery<Servicio[]>({
    queryKey: ["servicios"],
    queryFn: () => fetch("/api/servicios").then((r) => r.json()),
  });

  const { data: encargados = [] } = useQuery<Encargado[]>({
    queryKey: ["encargados"],
    queryFn: () => fetch("/api/encargados").then((r) => r.json()),
  });

  const queryParams = new URLSearchParams();
  if (fecha) queryParams.set("fecha", fecha);
  if (servicioId) queryParams.set("servicio_id", servicioId);
  if (encargadoId) queryParams.set("encargado_id", encargadoId);
  if (estado) queryParams.set("estado", estado);

  const { data: citas = [], isLoading } = useQuery<Cita[]>({
    queryKey: ["citas", fecha, servicioId, encargadoId, estado],
    queryFn: () => fetch(`/api/citas?${queryParams.toString()}`).then((r) => r.json()),
  });

  const { mutate: accion, isPending } = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      fetch(`/api/citas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error al actualizar la cita");
        return d;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["citas"] });
      setCancelandoId(null);
      setMotivo("");
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 bg-white rounded-lg shadow-sm p-4">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Fecha</label>
          <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Servicio</label>
          <select
            value={servicioId}
            onChange={(e) => setServicioId(e.target.value)}
            className="text-sm border border-gray-300 rounded px-3 py-2 w-48"
          >
            <option value="">Todos</option>
            {servicios.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Encargado</label>
          <select
            value={encargadoId}
            onChange={(e) => setEncargadoId(e.target.value)}
            className="text-sm border border-gray-300 rounded px-3 py-2 w-48"
          >
            <option value="">Todos</option>
            {encargados.map((enc) => (
              <option key={enc.id} value={enc.id}>{enc.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Estado</label>
          <select
            value={estado}
            onChange={(e) => setEstado(e.target.value as CitaEstado | "")}
            className="text-sm border border-gray-300 rounded px-3 py-2 w-40"
          >
            {ESTADOS.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto">
          <Button onClick={() => setNuevaAbierta(true)}>+ Nueva cita</Button>
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {isLoading && <p className="text-sm text-gray-400 p-4 text-center">Cargando...</p>}
        {!isLoading && citas.length === 0 && (
          <p className="text-sm text-gray-400 p-4 text-center">Sin citas para los filtros seleccionados</p>
        )}
        {citas.map((c) => (
          <div key={c.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800">{c.hora_inicio.slice(0, 5)}–{c.hora_fin.slice(0, 5)}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${COLOR_ESTADO[c.estado]}`}>{c.estado}</span>
              </div>
              <p className="text-sm text-gray-700 mt-0.5">
                {c.cliente?.nombre ?? "—"}
                {c.mascota?.nombre ? ` · ${c.mascota.nombre}` : ""}
              </p>
              <p className="text-xs text-gray-400">
                {c.servicio?.nombre ?? "—"} · {c.duracion_minutos} min
                {c.precio != null ? ` · $${Number(c.precio).toLocaleString("es-CL")}` : ""}
                {c.encargado?.nombre ? ` · ${c.encargado.nombre}` : " · Sin asignar"}
                {c.cliente?.telefono ? ` · ${c.cliente.telefono}` : ""}
              </p>
              {c.notas && <p className="text-xs text-gray-400 italic">{c.notas}</p>}
              {c.estado === "cancelada" && (
                <>
                  {c.motivo_cancelacion && (
                    <p className="text-xs text-red-400">Motivo: {c.motivo_cancelacion}</p>
                  )}
                  {c.cancelado_at && (
                    <p className="text-xs text-gray-400">Cancelada el {formatFechaHora(c.cancelado_at)}</p>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setDetalleCita(c)}
                className="text-xs text-blue-500 hover:underline"
              >
                Ver detalle
              </button>
              {c.estado === "confirmada" && (
                <>
                {c.precio != null ? (
                  <button
                    onClick={() => setCobrando(c)}
                    disabled={isPending}
                    className="text-xs text-green-600 hover:underline font-medium"
                  >
                    Completar y cobrar
                  </button>
                ) : (
                  <button
                    onClick={() => accion({ id: c.id, body: { accion: "completar" } })}
                    disabled={isPending}
                    className="text-xs text-blue-500 hover:underline"
                  >
                    Completar
                  </button>
                )}
                <button
                  onClick={() => accion({ id: c.id, body: { accion: "no_show" } })}
                  disabled={isPending}
                  className="text-xs text-orange-500 hover:underline"
                >
                  No show
                </button>
                <button
                  onClick={() => { setCancelandoId(c.id); setMotivo(""); }}
                  className="text-xs text-red-400 hover:underline"
                >
                  Cancelar
                </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {nuevaAbierta && (
        <ModalOverlay open onClose={() => setNuevaAbierta(false)}>
          <NuevaCitaForm onClose={() => setNuevaAbierta(false)} fechaInicial={fecha} />
        </ModalOverlay>
      )}

      {cancelandoId && (
        <ModalOverlay open onClose={() => setCancelandoId(null)}>
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-semibold text-gray-800 mb-2">Cancelar cita</h3>
            <p className="text-sm text-gray-500 mb-3">Indica el motivo de la cancelación (mínimo 5 caracteres).</p>
            <Input
              placeholder="Motivo de cancelación *"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={() => setCancelandoId(null)} className="flex-1">Volver</Button>
              <Button
                variant="destructive"
                onClick={() => accion({ id: cancelandoId, body: { accion: "cancelar", motivo } })}
                disabled={motivo.trim().length < 5 || isPending}
                className="flex-1"
              >
                {isPending ? "Cancelando..." : "Confirmar cancelación"}
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {cobrando && (
        <ModalCobroCita
          cita={cobrando}
          onClose={() => setCobrando(null)}
          onSuccess={() => {
            setCobrando(null);
            queryClient.invalidateQueries({ queryKey: ["citas"] });
          }}
        />
      )}

      {detalleCita && (
        <ModalOverlay open onClose={() => setDetalleCita(null)}>
          <DetalleCita cita={detalleCita} onClose={() => setDetalleCita(null)} />
        </ModalOverlay>
      )}
    </div>
  );
}
