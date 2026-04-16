"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminRole, canEditStore } from "@/hooks/useAdminAuth";

interface Store {
  id: string;
  name: string;
  rut: string | null;
  email: string | null;
  phone: string | null;
  whatsapp_enabled: boolean;
  created_at: string;
}

interface TiendaCardProps {
  store: Store;
  role: AdminRole;
}

export function TiendaCard({ store, role }: TiendaCardProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: store.name,
    rut: store.rut || "",
    email: store.email || "",
    phone: store.phone || "",
    whatsapp_enabled: store.whatsapp_enabled,
  });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const canEdit = canEditStore(role);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/stores/${store.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      return data;
    },
    onSuccess: () => {
      setMessage({ ok: true, text: "Tienda actualizada correctamente" });
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ["admin-stores"] });
      setTimeout(() => setMessage(null), 3000);
    },
    onError: (e: Error) => {
      setMessage({ ok: false, text: e.message });
    },
  });

  const handleSave = () => {
    mutation.mutate();
  };

  const handleCancel = () => {
    setFormData({
      name: store.name,
      rut: store.rut || "",
      email: store.email || "",
      phone: store.phone || "",
      whatsapp_enabled: store.whatsapp_enabled,
    });
    setIsEditing(false);
    setMessage(null);
  };

  return (
    <div className="bg-white rounded-lg border border-[rgba(45,52,54,0.12)] p-6 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-[#1a5f3f] flex items-center gap-2">
          📋 Mi Tienda
        </h2>
        {canEdit && !isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="px-3 py-1 text-sm font-medium text-[#1a5f3f] hover:bg-[rgba(26,95,63,0.08)] rounded-md transition-colors"
          >
            Editar información
          </button>
        )}
      </div>

      {/* Form Grid */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Nombre */}
          <FormGroup label="Nombre">
            <input
              type="text"
              disabled={!isEditing}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className={`w-full px-3 py-2 border rounded-lg font-family-inter text-sm transition-all ${
                isEditing
                  ? "bg-white border-[rgba(45,52,54,0.15)] focus:border-[#d4a574] focus:outline-none focus:shadow-[inset_0_0_0_2px_rgba(212,165,116,0.1)]"
                  : "bg-[#fafaf8] border-[rgba(45,52,54,0.12)] text-[#2d3436] cursor-not-allowed"
              }`}
            />
          </FormGroup>

          {/* RUT */}
          <FormGroup label="RUT">
            <input
              type="text"
              disabled={!isEditing}
              value={formData.rut}
              onChange={(e) => setFormData({ ...formData, rut: e.target.value })}
              className={`w-full px-3 py-2 border rounded-lg font-family-inter text-sm transition-all ${
                isEditing
                  ? "bg-white border-[rgba(45,52,54,0.15)] focus:border-[#d4a574] focus:outline-none focus:shadow-[inset_0_0_0_2px_rgba(212,165,116,0.1)]"
                  : "bg-[#fafaf8] border-[rgba(45,52,54,0.12)] text-[#2d3436] cursor-not-allowed"
              }`}
            />
          </FormGroup>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Email */}
          <FormGroup label="Email">
            <input
              type="email"
              disabled={!isEditing}
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className={`w-full px-3 py-2 border rounded-lg font-family-inter text-sm transition-all ${
                isEditing
                  ? "bg-white border-[rgba(45,52,54,0.15)] focus:border-[#d4a574] focus:outline-none focus:shadow-[inset_0_0_0_2px_rgba(212,165,116,0.1)]"
                  : "bg-[#fafaf8] border-[rgba(45,52,54,0.12)] text-[#2d3436] cursor-not-allowed"
              }`}
            />
          </FormGroup>

          {/* Teléfono */}
          <FormGroup label="Teléfono">
            <input
              type="tel"
              disabled={!isEditing}
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className={`w-full px-3 py-2 border rounded-lg font-family-inter text-sm transition-all ${
                isEditing
                  ? "bg-white border-[rgba(45,52,54,0.15)] focus:border-[#d4a574] focus:outline-none focus:shadow-[inset_0_0_0_2px_rgba(212,165,116,0.1)]"
                  : "bg-[#fafaf8] border-[rgba(45,52,54,0.12)] text-[#2d3436] cursor-not-allowed"
              }`}
            />
          </FormGroup>
        </div>

        {/* WhatsApp Toggle */}
        <div className="flex items-center gap-3 py-2">
          <input
            type="checkbox"
            disabled={!isEditing}
            checked={formData.whatsapp_enabled}
            onChange={(e) => setFormData({ ...formData, whatsapp_enabled: e.target.checked })}
            className="w-4 h-4 rounded accent-[#1a5f3f] cursor-pointer"
          />
          <label className="text-sm text-[#2d3436] font-medium">WhatsApp habilitado</label>
        </div>

        {/* Actions */}
        {isEditing && (
          <div className="flex gap-3 pt-4 border-t border-[rgba(45,52,54,0.06)]">
            <button
              onClick={handleSave}
              disabled={mutation.isPending}
              className="px-4 py-2 bg-[#1a5f3f] text-white text-sm font-medium rounded-lg hover:bg-[#0d4730] disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? "Guardando..." : "Guardar cambios"}
            </button>
            <button
              onClick={handleCancel}
              disabled={mutation.isPending}
              className="px-4 py-2 bg-white border border-[#1a5f3f] text-[#1a5f3f] text-sm font-medium rounded-lg hover:bg-[rgba(26,95,63,0.08)] disabled:opacity-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        )}

        {/* Message */}
        {message && (
          <div
            className={`mt-4 text-sm font-medium ${
              message.ok ? "text-green-600" : "text-red-600"
            }`}
          >
            {message.text}
          </div>
        )}
      </div>

      {!canEdit && !isEditing && (
        <p className="mt-4 text-xs text-[#999]">
          Solo systemAdmin puede editar la información de la tienda
        </p>
      )}
    </div>
  );
}

function FormGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <label className="text-xs font-semibold text-[#666] uppercase mb-1.5 tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}
