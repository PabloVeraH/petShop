"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import type { Encargado } from "@/types";

export function EncargadosTab() {
  const { user } = useUser();
  const meta = user?.publicMetadata as Record<string, unknown> | undefined;
  const isAdmin = !!(meta?.storeAdmin || meta?.systemAdmin);

  const [nombre, setNombre] = useState("");
  const [editando, setEditando] = useState<Encargado | null>(null);
  const [error, setError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: encargados = [], isLoading } = useQuery<Encargado[]>({
    queryKey: ["encargados"],
    queryFn: () => fetch("/api/encargados").then((r) => r.json()),
  });

  const { mutate: crearEncargado, isPending: creando } = useMutation({
    mutationFn: () =>
      fetch("/api/encargados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error al crear");
        return d;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["encargados"] });
      setNombre(""); setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const { mutate: actualizarEncargado, isPending: actualizando } = useMutation({
    mutationFn: () =>
      fetch(`/api/encargados/${editando!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error al actualizar");
        return d;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["encargados"], refetchType: "all" });
      setEditando(null); setNombre(""); setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const { mutate: eliminarEncargado } = useMutation({
    mutationFn: (id: string) => fetch(`/api/encargados/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["encargados"] });
      setConfirmDeleteId(null);
    },
  });

  function abrirEditar(e: Encargado) {
    setEditando(e);
    setNombre(e.nombre);
    setError("");
  }

  function cancelar() {
    setEditando(null); setNombre(""); setError("");
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-gray-400">Solo administradores pueden gestionar encargados.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="bg-white rounded-lg shadow-sm p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">
          {editando ? `Editar: ${editando.nombre}` : "Nuevo encargado"}
        </h2>
        <div className="space-y-2">
          <Input
            placeholder="Nombre * (ej: Juan Pérez)"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2">
          {editando && (
            <Button variant="outline" onClick={cancelar} className="flex-1">Cancelar</Button>
          )}
          <Button
            onClick={() => editando ? actualizarEncargado() : crearEncargado()}
            disabled={!nombre.trim() || creando || actualizando}
            className="flex-1"
          >
            {creando || actualizando ? "Guardando..." : editando ? "Guardar cambios" : "Crear encargado"}
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {isLoading && (
          <p className="text-sm text-gray-400 p-4 text-center">Cargando...</p>
        )}
        {!isLoading && encargados.length === 0 && (
          <p className="text-sm text-gray-400 p-4 text-center">Sin encargados creados</p>
        )}
        {encargados.map((e) => (
          <div key={e.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0">
            <div>
              <p className="text-sm font-medium text-gray-800">{e.nombre}</p>
              <p className="text-xs text-gray-400">
                {e.citas_totales ?? 0} citas tomadas · {e.citas_completadas ?? 0} finalizadas
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => abrirEditar(e)} className="text-xs text-blue-500 hover:underline">
                Editar
              </button>
              <button onClick={() => setConfirmDeleteId(e.id)} className="text-xs text-red-400 hover:underline">
                Desactivar
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmDeleteId && (
        <ModalOverlay open onClose={() => setConfirmDeleteId(null)}>
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-semibold text-gray-800 mb-2">¿Desactivar encargado?</h3>
            <p className="text-sm text-gray-500 mb-4">
              El encargado se desactivará y dejará de poder asignarse a citas nuevas. Las citas históricas se conservan.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConfirmDeleteId(null)} className="flex-1">
                Cancelar
              </Button>
              <Button variant="destructive" onClick={() => eliminarEncargado(confirmDeleteId!)} className="flex-1">
                Desactivar
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
