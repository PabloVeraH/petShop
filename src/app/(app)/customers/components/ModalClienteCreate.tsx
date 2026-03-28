"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateRUT } from "@/lib/validation";

export default function ModalClienteCreate({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ rut: "", nombre: "", email: "", telefono: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { mutate, isPending, error: mutError } = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Error al crear cliente");
      }
      return res.json();
    },
    onSuccess: () => onClose(),
  });

  const handleSubmit = () => {
    const errs: Record<string, string> = {};
    if (!validateRUT(form.rut)) errs.rut = "RUT inválido";
    if (form.nombre.trim().length < 3) errs.nombre = "Mínimo 3 caracteres";
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    mutate(form);
  };

  const setField = (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      setErrors((e) => ({ ...e, [key]: "" }));
    };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Nuevo Cliente</DialogTitle>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">RUT *</label>
            <Input placeholder="12.345.678-9" value={form.rut} onChange={setField("rut")} />
            {errors.rut && <p className="text-xs text-red-500 mt-0.5">{errors.rut}</p>}
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Nombre *</label>
            <Input value={form.nombre} onChange={setField("nombre")} />
            {errors.nombre && <p className="text-xs text-red-500 mt-0.5">{errors.nombre}</p>}
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Email</label>
            <Input type="email" value={form.email} onChange={setField("email")} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Teléfono</label>
            <Input value={form.telefono} onChange={setField("telefono")} />
          </div>
          {mutError && <p className="text-xs text-red-500">{mutError.message}</p>}
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
