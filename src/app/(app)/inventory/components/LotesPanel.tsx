"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LoteProducto, LoteConStatus } from "@/types";
import { getLoteStatus } from "@/lib/lote-helpers";

type LoteForm = {
  numero_lote: string;
  cantidad_inicial: string;
  cantidad_actual: string;
  fecha_vencimiento: string;
  notas: string;
};

const EMPTY_LOTE_FORM: LoteForm = {
  numero_lote: "",
  cantidad_inicial: "",
  cantidad_actual: "",
  fecha_vencimiento: "",
  notas: "",
};

interface LotesPanelProps {
  productoId: string;
  storeId: string;
  diasAlerta: number;
  esSoloLectura?: boolean;
}

async function getLotes(productoId: string, conStock = true): Promise<LoteProducto[]> {
  const params = new URLSearchParams({ producto_id: productoId });
  if (conStock) params.set("con_stock", "1");
  const res = await fetch(`/api/lotes?${params}`);
  if (!res.ok) throw new Error("Error al cargar lotes");
  const data = await res.json();
  return data.lotes ?? [];
}

async function crearLote(body: Record<string, unknown>) {
  const res = await fetch("/api/lotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Error al crear lote");
  }
  return res.json();
}

async function actualizarLote(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/lotes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Error al actualizar lote");
  }
  return res.json();
}

async function desactivarLote(id: string) {
  const res = await fetch(`/api/lotes/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Error al desactivar lote");
  }
  return res.json();
}

export function LotesPanel({ productoId, diasAlerta, esSoloLectura }: LotesPanelProps) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editando, setEditando] = useState<LoteProducto | null>(null);
  const [form, setForm] = useState<LoteForm>(EMPTY_LOTE_FORM);
  const [formError, setFormError] = useState("");

  const { data: lotes = [], isLoading } = useQuery({
    queryKey: ["lotes", productoId],
    queryFn: () => getLotes(productoId),
  });

  const crearMutation = useMutation({
    mutationFn: crearLote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lotes", productoId] });
      queryClient.invalidateQueries({ queryKey: ["inventario"] });
      setShowForm(false);
      setForm(EMPTY_LOTE_FORM);
      setFormError("");
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const actualizarMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      actualizarLote(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lotes", productoId] });
      queryClient.invalidateQueries({ queryKey: ["inventario"] });
      setEditando(null);
      setForm(EMPTY_LOTE_FORM);
      setFormError("");
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const desactivarMutation = useMutation({
    mutationFn: desactivarLote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lotes", productoId] });
      queryClient.invalidateQueries({ queryKey: ["inventario"] });
    },
  });

  function abrirNuevo() {
    setEditando(null);
    setForm(EMPTY_LOTE_FORM);
    setFormError("");
    setShowForm(true);
  }

  function abrirEditar(l: LoteProducto) {
    setEditando(l);
    setForm({
      numero_lote: l.numero_lote ?? "",
      cantidad_inicial: String(l.cantidad_inicial),
      cantidad_actual: String(l.cantidad_actual),
      fecha_vencimiento: l.fecha_vencimiento,
      notas: l.notas ?? "",
    });
    setFormError("");
    setShowForm(true);
  }

  function handleSubmit() {
    if (editando) {
      actualizarMutation.mutate({
        id: editando.id,
        body: {
          numero_lote: form.numero_lote || null,
          cantidad_actual: Number(form.cantidad_actual),
          fecha_vencimiento: form.fecha_vencimiento,
          notas: form.notas || null,
        },
      });
    } else {
      crearMutation.mutate({
        producto_id: productoId,
        numero_lote: form.numero_lote || null,
        cantidad_inicial: Number(form.cantidad_inicial),
        cantidad_actual: form.cantidad_actual ? Number(form.cantidad_actual) : Number(form.cantidad_inicial),
        fecha_vencimiento: form.fecha_vencimiento,
        notas: form.notas || null,
      });
    }
  }

  const enriched: LoteConStatus[] = lotes.map((l) => ({
    ...l,
    ...getLoteStatus(l.fecha_vencimiento, diasAlerta),
  }));

  function badgeClasses(status: string) {
    if (status === "vencido") return "bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-medium";
    if (status === "proximo") return "bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs font-medium";
    return "bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-medium";
  }

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Lotes de vencimiento</h3>
          <p className="text-xs text-gray-500">
            El stock total del producto se calcula automáticamente desde los lotes
          </p>
        </div>
        {!esSoloLectura && (
          <Button size="sm" variant="outline" onClick={abrirNuevo}>
            + Agregar Lote
          </Button>
        )}
      </div>

      {isLoading && <p className="text-sm text-gray-400 text-center py-4">Cargando lotes...</p>}
      {!isLoading && lotes.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">Sin lotes registrados</p>
      )}
      {!isLoading && lotes.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>N° Lote</TableHead>
              <TableHead className="text-right">Cant. Actual</TableHead>
              <TableHead className="text-right">Cant. Inicial</TableHead>
              <TableHead>Vence</TableHead>
              <TableHead>Estado</TableHead>
              {!esSoloLectura && <TableHead>Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {enriched.map((l) => (
              <TableRow key={l.id} className={l.status === "vencido" ? "bg-red-50" : l.status === "proximo" ? "bg-amber-50" : undefined}>
                <TableCell className="text-sm font-medium">{l.numero_lote ?? "—"}</TableCell>
                <TableCell className="text-right text-sm">{l.cantidad_actual}</TableCell>
                <TableCell className="text-right text-sm text-gray-500">{l.cantidad_inicial}</TableCell>
                <TableCell className="text-sm">
                  {l.fecha_vencimiento.split("T")[0]}
                </TableCell>
                <TableCell>
                  <span className={badgeClasses(l.status)}>{l.label}</span>
                </TableCell>
                {!esSoloLectura && (
                  <TableCell>
                    <div className="flex gap-1">
                      <button
                        onClick={() => abrirEditar(l)}
                        className="text-xs text-blue-500 hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => desactivarMutation.mutate(l.id)}
                        className="text-xs text-red-400 hover:underline ml-2"
                      >
                        Desactivar
                      </button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 mt-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-gray-800 mb-4">
              {editando ? "Editar Lote" : "Agregar Lote"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">N° de Lote</label>
                <Input
                  value={form.numero_lote}
                  onChange={(e) => setForm((f) => ({ ...f, numero_lote: e.target.value }))}
                  placeholder="Opcional"
                />
              </div>
              {!editando && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad Inicial *</label>
                  <Input
                    type="number"
                    min={1}
                    value={form.cantidad_inicial}
                    onChange={(e) => setForm((f) => ({ ...f, cantidad_inicial: e.target.value, cantidad_actual: f.cantidad_actual || e.target.value }))}
                    placeholder="10"
                  />
                </div>
              )}
              {editando && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad Actual</label>
                  <Input
                    type="number"
                    min={0}
                    value={form.cantidad_actual}
                    onChange={(e) => setForm((f) => ({ ...f, cantidad_actual: e.target.value }))}
                    placeholder="10"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Vencimiento *</label>
                <Input
                  type="date"
                  value={form.fecha_vencimiento}
                  onChange={(e) => setForm((f) => ({ ...f, fecha_vencimiento: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
                <Input
                  value={form.notas}
                  onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
                  placeholder="Opcional"
                />
              </div>
            </div>
            {formError && <p className="text-xs text-red-500 mt-3">{formError}</p>}
            <div className="flex gap-2 mt-5">
              <Button
                variant="outline"
                onClick={() => { setShowForm(false); setEditando(null); setForm(EMPTY_LOTE_FORM); setFormError(""); }}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={
                  Boolean(crearMutation.isPending ||
                  actualizarMutation.isPending ||
                  (!editando && (!form.cantidad_inicial || !form.fecha_vencimiento)) ||
                  (editando && !form.fecha_vencimiento))
                }
                className="flex-1"
              >
                {crearMutation.isPending || actualizarMutation.isPending
                  ? "Guardando..."
                  : editando
                  ? "Guardar"
                  : "Crear Lote"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}