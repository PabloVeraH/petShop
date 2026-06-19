"use client";

import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type NuevaMascota = { id: string; nombre: string; tipo: string; raza?: string | null; peso_kg?: number | null };

export default function ModalMascotaCreate({
  clienteId,
  onClose,
  onCreated,
}: {
  clienteId: string;
  onClose: () => void;
  onCreated?: (mascota: NuevaMascota) => void;
}) {
  const [form, setForm] = useState({ nombre: "", tipo: "perro", raza: "", peso_kg: "" });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => onClose(), 1500);
    return () => clearTimeout(t);
  }, [saved, onClose]);

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/mascotas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId,
          nombre: form.nombre.trim(),
          tipo: form.tipo,
          raza: form.raza.trim() || undefined,
          peso_kg: form.peso_kg ? Number(form.peso_kg) : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Error al crear mascota");
      }
      return res.json() as Promise<NuevaMascota>;
    },
    onSuccess: (mascota) => {
      onCreated?.(mascota);
      setSaved(true);
    },
    onError: (e: Error) => setError(e.message),
  });

  const handleSubmit = () => {
    if (form.nombre.trim().length < 2) {
      setError("Nombre debe tener al menos 2 caracteres");
      return;
    }
    mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saved && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Nueva Mascota</DialogTitle>

        {saved ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-green-700">¡Mascota registrada!</p>
            <p className="text-xs text-gray-400">Cerrando...</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Nombre *</label>
              <Input
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Tipo *</label>
              <select
                value={form.tipo}
                onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
                className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
              >
                <option value="perro">Perro</option>
                <option value="gato">Gato</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Raza</label>
              <Input
                value={form.raza}
                onChange={(e) => setForm((f) => ({ ...f, raza: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Peso (kg)</label>
              <Input
                type="number"
                step="0.1"
                value={form.peso_kg}
                onChange={(e) => setForm((f) => ({ ...f, peso_kg: e.target.value }))}
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
              <Button onClick={handleSubmit} disabled={isPending} className="flex-1">
                {isPending ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
