"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ModalMascotaCreate({
  clienteId,
  onClose,
}: {
  clienteId: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ nombre: "", tipo: "perro", raza: "", peso_kg: "" });
  const [error, setError] = useState("");

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
      return res.json();
    },
    onSuccess: () => onClose(),
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Nueva Mascota</DialogTitle>
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
      </DialogContent>
    </Dialog>
  );
}
