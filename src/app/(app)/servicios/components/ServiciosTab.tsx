"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { HorarioSemanalEditor } from "./HorarioSemanalEditor";
import type { Servicio } from "@/types";

export function ServiciosTab() {
  const { user } = useUser();
  const meta = user?.publicMetadata as Record<string, unknown> | undefined;
  const isAdmin = !!(meta?.storeAdmin || meta?.systemAdmin);

  const DURACIONES_VALIDAS = [30, 60, 90] as const;

  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [duracionMinutos, setDuracionMinutos] = useState<30 | 60 | 90>(30);
  const [editando, setEditando] = useState<Servicio | null>(null);
  const [error, setError] = useState("");
  const [horarioAbierto, setHorarioAbierto] = useState<Servicio | null>(null);
  const queryClient = useQueryClient();

  const { data: servicios = [], isLoading } = useQuery<Servicio[]>({
    queryKey: ["servicios"],
    queryFn: () => fetch("/api/servicios").then((r) => r.json()),
  });

  const { mutate: crearServicio, isPending: creando } = useMutation({
    mutationFn: () =>
      fetch("/api/servicios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          descripcion: descripcion || undefined,
          duracion_minutos: duracionMinutos,
        }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error al crear");
        return d;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servicios"] });
      setNombre(""); setDescripcion(""); setDuracionMinutos(30); setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const { mutate: actualizarServicio, isPending: actualizando } = useMutation({
    mutationFn: () =>
      fetch(`/api/servicios/${editando!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          descripcion: descripcion || undefined,
          duracion_minutos: duracionMinutos,
        }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error al actualizar");
        return d;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servicios"], refetchType: "all" });
      setEditando(null); setNombre(""); setDescripcion(""); setDuracionMinutos(30); setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { mutate: eliminarServicio } = useMutation({
    mutationFn: (id: string) => fetch(`/api/servicios/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servicios"] });
      setConfirmDeleteId(null);
    },
  });

  function abrirEditar(s: Servicio) {
    setEditando(s);
    setNombre(s.nombre);
    setDescripcion(s.descripcion ?? "");
    // duracion_minutos viene de la BD (CHECK IN (30,60,90)) — solo puede ser uno de esos valores.
    setDuracionMinutos(s.duracion_minutos as 30 | 60 | 90);
    setError("");
  }

  function cancelar() {
    setEditando(null); setNombre(""); setDescripcion(""); setDuracionMinutos(30); setError("");
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-gray-400">Solo administradores pueden gestionar servicios.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="bg-white rounded-lg shadow-sm p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">
          {editando ? `Editar: ${editando.nombre}` : "Nuevo servicio"}
        </h2>
        <div className="space-y-2">
          <Input
            placeholder="Nombre * (ej: Peluquería — Corte básico)"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
          <Input
            placeholder="Descripción (opcional)"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 shrink-0">Duración:</label>
            <select
              value={duracionMinutos}
              onChange={(e) => setDuracionMinutos(Number(e.target.value) as 30 | 60 | 90)}
              className="text-sm border border-gray-300 rounded px-2 py-1.5 w-28"
            >
              {DURACIONES_VALIDAS.map((d) => (
                <option key={d} value={d}>{d} min</option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2">
          {editando && (
            <Button variant="outline" onClick={cancelar} className="flex-1">Cancelar</Button>
          )}
          <Button
            onClick={() => editando ? actualizarServicio() : crearServicio()}
            disabled={!nombre.trim() || creando || actualizando}
            className="flex-1"
          >
            {creando || actualizando ? "Guardando..." : editando ? "Guardar cambios" : "Crear servicio"}
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {isLoading && (
          <p className="text-sm text-gray-400 p-4 text-center">Cargando...</p>
        )}
        {!isLoading && servicios.length === 0 && (
          <p className="text-sm text-gray-400 p-4 text-center">Sin servicios creados</p>
        )}
        {servicios.map((s) => (
          <div key={s.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0">
            <div>
              <p className="text-sm font-medium text-gray-800">{s.nombre}</p>
              <div className="flex gap-2 items-center">
                {s.descripcion && <p className="text-xs text-gray-400">{s.descripcion}</p>}
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                  {s.duracion_minutos} min
                </span>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => setHorarioAbierto(s)} className="text-xs text-green-500 hover:underline">
                Horario
              </button>
              <button onClick={() => abrirEditar(s)} className="text-xs text-blue-500 hover:underline">
                Editar
              </button>
              <button onClick={() => setConfirmDeleteId(s.id)} className="text-xs text-red-400 hover:underline">
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmDeleteId && (
        <ModalOverlay open onClose={() => setConfirmDeleteId(null)}>
        <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm mx-4">
          <h3 className="text-base font-semibold text-gray-800 mb-2">¿Desactivar servicio?</h3>
          <p className="text-sm text-gray-500 mb-4">
            El servicio se desactivará y dejará de aparecer en el catálogo.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)} className="flex-1">
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => eliminarServicio(confirmDeleteId!)} className="flex-1">
              Desactivar
            </Button>
          </div>
        </div>
      </ModalOverlay>
      )}

      {horarioAbierto && (
        <ModalOverlay open onClose={() => setHorarioAbierto(null)}>
          <HorarioSemanalEditor
            servicio={horarioAbierto}
            onClose={() => setHorarioAbierto(null)}
          />
        </ModalOverlay>
      )}
    </div>
  );
}