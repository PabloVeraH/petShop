"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatRUT } from "@/lib/validation";
import ModalMascotaCreate from "./ModalMascotaCreate";
import ConsumoConfigSection from "./ConsumoConfigSection";
import type { Cliente } from "@/types";

type MascotaItem = {
  id: string;
  nombre: string;
  tipo: string;
  raza?: string | null;
  peso_kg?: number | null;
};

type EditClienteForm = { nombre: string; email: string; telefono: string };
type EditMascotaForm = { nombre: string; tipo: string; raza: string; peso_kg: string };

type VentaItem = {
  id: string;
  total: number;
  metodo_pago: string | null;
  created_at: string;
};

type DetalleData = Cliente & {
  mascotas: MascotaItem[];
  ventas: VentaItem[];
};

export default function ClienteDetalle({
  cliente,
}: {
  cliente: Cliente;
  onRefresh: () => void;
}) {
  const [showMascotaModal, setShowMascotaModal] = useState(false);
  const [editingCliente, setEditingCliente] = useState(false);
  const [clienteForm, setClienteForm] = useState<EditClienteForm>({ nombre: "", email: "", telefono: "" });
  const [editingMascota, setEditingMascota] = useState<MascotaItem | null>(null);
  const [mascotaForm, setMascotaForm] = useState<EditMascotaForm>({ nombre: "", tipo: "", raza: "", peso_kg: "" });
  const [formError, setFormError] = useState("");
  const queryClient = useQueryClient();

  const { mutate: guardarCliente, isPending: savingCliente } = useMutation({
    mutationFn: () =>
      fetch(`/api/clientes/${cliente.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clienteForm),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error al guardar");
        return d;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cliente-detalle", cliente.id] });
      queryClient.invalidateQueries({ queryKey: ["clientes"] });
      setEditingCliente(false);
      setFormError("");
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const { mutate: guardarMascota, isPending: savingMascota } = useMutation({
    mutationFn: () =>
      fetch(`/api/mascotas/${editingMascota!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mascotaForm),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error al guardar");
        return d;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cliente-detalle", cliente.id] });
      setEditingMascota(null);
      setFormError("");
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const { data, isLoading } = useQuery<DetalleData>({
    queryKey: ["cliente-detalle", cliente.id],
    queryFn: async () => {
      const res = await fetch(`/api/clientes/${cliente.id}`);
      if (!res.ok) throw new Error("Error al cargar detalle");
      return res.json();
    },
  });

  if (isLoading) return <p className="text-sm text-gray-400">Cargando...</p>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* Header */}
      {editingCliente ? (
        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium text-gray-600">Nombre</label>
            <input value={clienteForm.nombre} onChange={(e) => setClienteForm((f) => ({ ...f, nombre: e.target.value }))}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm mt-0.5 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Email</label>
            <input value={clienteForm.email} onChange={(e) => setClienteForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm mt-0.5 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Teléfono</label>
            <input value={clienteForm.telefono} onChange={(e) => setClienteForm((f) => ({ ...f, telefono: e.target.value }))}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm mt-0.5 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={() => guardarCliente()} disabled={savingCliente}>
              {savingCliente ? "Guardando..." : "Guardar"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setEditingCliente(false); setFormError(""); }}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">{data.nombre}</h2>
              <p className="text-sm text-gray-500">{formatRUT(data.rut)}</p>
              {data.email && <p className="text-xs text-gray-400">{data.email}</p>}
              {data.telefono && <p className="text-xs text-gray-400">{data.telefono}</p>}
            </div>
            <button
              onClick={() => { setClienteForm({ nombre: data.nombre, email: data.email ?? "", telefono: data.telefono ?? "" }); setFormError(""); setEditingCliente(true); }}
              className="text-xs text-blue-500 hover:underline shrink-0 mt-1"
            >
              Editar
            </button>
          </div>
        </div>
      )}

      {/* Mascotas */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-gray-700">Mascotas</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowMascotaModal(true)}
          >
            + Agregar
          </Button>
        </div>
        {data.mascotas.length === 0 ? (
          <p className="text-xs text-gray-400">Sin mascotas registradas</p>
        ) : (
          <div className="space-y-2">
            {data.mascotas.map((m) => (
              <div key={m.id} className="rounded bg-gray-50 px-3 py-2 text-sm">
                {editingMascota?.id === m.id ? (
                  <div className="space-y-2">
                    {[
                      { label: "Nombre", key: "nombre" as const },
                      { label: "Tipo", key: "tipo" as const, placeholder: "perro / gato / otro" },
                      { label: "Raza", key: "raza" as const },
                      { label: "Peso (kg)", key: "peso_kg" as const, type: "number" },
                    ].map(({ label, key, placeholder, type }) => (
                      <div key={key}>
                        <label className="text-xs font-medium text-gray-600">{label}</label>
                        <input type={type ?? "text"} value={mascotaForm[key]}
                          onChange={(e) => setMascotaForm((f) => ({ ...f, [key]: e.target.value }))}
                          placeholder={placeholder}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 focus:outline-none focus:ring-2 focus:ring-green-500" />
                      </div>
                    ))}
                    {formError && <p className="text-xs text-red-500">{formError}</p>}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => guardarMascota()} disabled={savingMascota}>
                        {savingMascota ? "..." : "Guardar"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setEditingMascota(null); setFormError(""); }}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium">{m.nombre}</span>
                      <span className="text-gray-400 ml-2 text-xs">
                        {m.tipo}{m.raza ? ` · ${m.raza}` : ""}{m.peso_kg ? ` · ${m.peso_kg}kg` : ""}
                      </span>
                    </div>
                    <button
                      onClick={() => { setMascotaForm({ nombre: m.nombre, tipo: m.tipo ?? "", raza: m.raza ?? "", peso_kg: m.peso_kg ? String(m.peso_kg) : "" }); setFormError(""); setEditingMascota(m); }}
                      className="text-xs text-blue-500 hover:underline ml-2 shrink-0"
                    >
                      Editar
                    </button>
                  </div>
                )}
                <ConsumoConfigSection mascotaId={m.id} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historial compras */}
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-2">Últimas compras</p>
        {data.ventas.length === 0 ? (
          <p className="text-xs text-gray-400">Sin compras aún</p>
        ) : (
          <div className="space-y-1">
            {data.ventas.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between text-sm border-b last:border-0 py-1.5"
              >
                <span className="text-gray-500 text-xs">
                  {new Date(v.created_at).toLocaleDateString("es-CL")} ·{" "}
                  {v.metodo_pago ?? "efectivo"}
                </span>
                <span className="font-medium text-green-700">
                  ${Math.round(Number(v.total)).toLocaleString("es-CL")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showMascotaModal && (
        <ModalMascotaCreate
          clienteId={cliente.id}
          onClose={() => {
            setShowMascotaModal(false);
            queryClient.invalidateQueries({ queryKey: ["cliente-detalle", cliente.id] });
          }}
        />
      )}
    </div>
  );
}
