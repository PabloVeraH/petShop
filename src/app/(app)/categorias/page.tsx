"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Categoria = {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  es_alimento: boolean;
};

export default function CategoriasPage() {
  const { user } = useUser();
  const meta = user?.publicMetadata as Record<string, unknown> | undefined;
  const isAdmin = !!(meta?.storeAdmin || meta?.systemAdmin);

  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [esAlimento, setEsAlimento] = useState(false);
  const [editando, setEditando] = useState<Categoria | null>(null);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();

  const { data: categorias = [], isLoading } = useQuery<Categoria[]>({
    queryKey: ["categorias"],
    queryFn: () => fetch("/api/categorias").then((r) => r.json()),
  });

  const { mutate: crearCategoria, isPending: creando } = useMutation({
    mutationFn: () =>
      fetch("/api/categorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, descripcion: descripcion || undefined }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error al crear");
        return d;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias"] });
      setNombre("");
      setDescripcion("");
      setEsAlimento(false);
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const { mutate: actualizarCategoria, isPending: actualizando } = useMutation({
    mutationFn: () =>
      fetch(`/api/categorias/${editando!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, descripcion: descripcion || undefined, es_alimento: esAlimento }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error al actualizar");
        return d;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias"] });
      setEditando(null);
      setNombre("");
      setDescripcion("");
      setEsAlimento(false);
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const { mutate: eliminarCategoria } = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/categorias/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categorias"] }),
  });

  function abrirEditar(c: Categoria) {
    setEditando(c);
    setNombre(c.nombre);
    setDescripcion(c.descripcion ?? "");
    setEsAlimento(c.es_alimento ?? false);
    setError("");
  }

  function cancelar() {
    setEditando(null);
    setNombre("");
    setDescripcion("");
    setEsAlimento(false);
    setError("");
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-gray-400">Solo administradores pueden gestionar categorías.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <h1 className="text-xl font-bold text-gray-900">Categorías de productos</h1>

      <div className="bg-white rounded-lg shadow-sm p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">
          {editando ? `Editar: ${editando.nombre}` : "Nueva categoría"}
        </h2>
        <div className="space-y-2">
          <Input
            placeholder="Nombre *"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
          <Input
            placeholder="Descripción (opcional)"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={esAlimento}
              onChange={(e) => setEsAlimento(e.target.checked)}
              className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
            />
            <span className="text-sm text-gray-700">Es categoría de alimento</span>
          </label>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2">
          {editando && (
            <Button variant="outline" onClick={cancelar} className="flex-1">
              Cancelar
            </Button>
          )}
          <Button
            onClick={() => (editando ? actualizarCategoria() : crearCategoria())}
            disabled={!nombre.trim() || creando || actualizando}
            className="flex-1"
          >
            {creando || actualizando ? "Guardando..." : editando ? "Guardar cambios" : "Crear categoría"}
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {isLoading && (
          <p className="text-sm text-gray-400 p-4 text-center">Cargando...</p>
        )}
        {!isLoading && categorias.length === 0 && (
          <p className="text-sm text-gray-400 p-4 text-center">Sin categorías creadas</p>
        )}
        {categorias.map((c) => (
          <div key={c.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0">
            <div>
              <p className="text-sm font-medium text-gray-800">{c.nombre}</p>
              <div className="flex gap-2 items-center">
                {c.descripcion && (
                  <p className="text-xs text-gray-400">{c.descripcion}</p>
                )}
                {c.es_alimento && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Alimento</span>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => abrirEditar(c)}
                className="text-xs text-blue-500 hover:underline"
              >
                Editar
              </button>
              <button
                onClick={() => eliminarCategoria(c.id)}
                className="text-xs text-red-400 hover:underline"
              >
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
