"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { parseDateOnlyLocal } from "@/lib/dates";

interface LicenseConfig {
  license_start_date: string | null;
  license_end_date: string | null;
  license_warning_days: number;
}

interface LicenseStatus {
  isAutoBlocked: boolean;
  isInWarningPeriod: boolean;
  daysUntilExpiry: number | null;
  licenseEndDate: string | null;
}

interface LicenseData {
  config: LicenseConfig;
  status: LicenseStatus;
}

interface User {
  clerk_id: string;
  email: string | null;
  store_admin: boolean;
  store_worker: boolean;
  is_disabled: boolean;
}

export function LicenciaCard() {
  const queryClient = useQueryClient();
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"disable" | "enable" | null>(null);

  const { data: licenseData, isLoading: licenseLoading } = useQuery<LicenseData>({
    queryKey: ["license-config"],
    queryFn: () => fetch("/api/admin/license").then((r) => r.json()),
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["license-users"],
    queryFn: () => fetch("/api/admin/license/users").then((r) => r.json()),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<LicenseConfig>) =>
      fetch("/api/admin/license", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["license-config"] });
    },
  });

  const userMutation = useMutation({
    mutationFn: ({ userIds, action }: { userIds: string[]; action: "disable" | "enable" }) =>
      fetch("/api/admin/license/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds, action }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["license-users"] });
      setSelectedUsers([]);
      setShowConfirm(false);
    },
  });

  const handleSaveConfig = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    updateMutation.mutate({
      license_start_date: formData.get("license_start_date") as string || null,
      license_end_date: formData.get("license_end_date") as string || null,
      license_warning_days: parseInt(formData.get("license_warning_days") as string) || 7,
    });
  };

  const handleSelectAll = () => {
    if (selectedUsers.length === users.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(users.map((u) => u.clerk_id));
    }
  };

  const handleUserAction = (action: "disable" | "enable") => {
    setConfirmAction(action);
    setShowConfirm(true);
  };

  const confirmActionHandler = () => {
    if (confirmAction && selectedUsers.length > 0) {
      userMutation.mutate({ userIds: selectedUsers, action: confirmAction });
    }
  };

  const getStateLabel = () => {
    if (!licenseData?.config.license_end_date) return "Sin configurar";
    if (licenseData?.status.isAutoBlocked) return "VENCIDA";
    if (licenseData?.status.isInWarningPeriod) return `En período de aviso (${licenseData.status.daysUntilExpiry} días)`;
    return "Activa";
  };

  const getStateColor = () => {
    if (!licenseData?.config.license_end_date) return "text-gray-500";
    if (licenseData?.status.isAutoBlocked) return "text-red-600";
    if (licenseData?.status.isInWarningPeriod) return "text-yellow-600";
    return "text-green-600";
  };

  if (licenseLoading) {
    return <p className="text-[#666]">Cargando...</p>;
  }

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-lg border border-[rgba(45,52,54,0.08)] p-6">
        <h2 className="text-lg font-bold text-[#1a5f3f] mb-4">Período de Licencia</h2>

        <div className="mb-4">
          <span className="text-sm text-gray-500">Estado: </span>
          <span className={`text-sm font-medium ${getStateColor()}`}>{getStateLabel()}</span>
        </div>

        <form onSubmit={handleSaveConfig} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de inicio</label>
              <input
                type="date"
                name="license_start_date"
                defaultValue={licenseData?.config.license_start_date ?? ""}
                className="w-full px-3 py-2 border border-gray-200 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de término</label>
              <input
                type="date"
                name="license_end_date"
                defaultValue={licenseData?.config.license_end_date ?? ""}
                className="w-full px-3 py-2 border border-gray-200 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Días de aviso previo (1-90)</label>
              <input
                type="number"
                name="license_warning_days"
                min="1"
                max="90"
                defaultValue={licenseData?.config.license_warning_days ?? 7}
                className="w-full px-3 py-2 border border-gray-200 rounded-md"
              />
            </div>
          </div>

          {licenseData?.config.license_end_date && licenseData?.config.license_warning_days && (
            <p className="text-sm text-gray-500">
              El banner de aviso aparecerá{" "}
              {new Date(parseDateOnlyLocal(licenseData.config.license_end_date).getTime() - licenseData.config.license_warning_days * 24 * 60 * 60 * 1000).toLocaleDateString("es-CL")}
            </p>
          )}

          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="bg-[#1a5f3f] text-white px-4 py-2 rounded-md hover:bg-[#154a32] disabled:opacity-50"
          >
            {updateMutation.isPending ? "Guardando..." : "Guardar"}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-lg border border-[rgba(45,52,54,0.08)] p-6">
        <h2 className="text-lg font-bold text-[#1a5f3f] mb-4">Acceso de Usuarios</h2>

        <div className="mb-4 flex items-center gap-4">
          <button
            onClick={handleSelectAll}
            className="text-sm text-[#1a5f3f] hover:underline"
          >
            {selectedUsers.length === users.length ? "Deseleccionar todos" : "Seleccionar todos"}
          </button>
          <span className="text-sm text-gray-500">{users.length} usuarios (excluyendo systemAdmin)</span>
        </div>

        <div className="space-y-2 mb-6 max-h-64 overflow-y-auto">
          {users.map((user) => (
            <div key={user.clerk_id} className="flex items-center gap-3 p-3 rounded-md bg-gray-50">
              <input
                type="checkbox"
                checked={selectedUsers.includes(user.clerk_id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedUsers([...selectedUsers, user.clerk_id]);
                  } else {
                    setSelectedUsers(selectedUsers.filter((id) => id !== user.clerk_id));
                  }
                }}
                className="w-4 h-4"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{user.email}</p>
                <p className="text-xs text-gray-500">
                  {user.store_admin ? "storeAdmin" : "storeWorker"}
                </p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${user.is_disabled ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                {user.is_disabled ? "Deshabilitado" : "Activo"}
              </span>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => handleUserAction("disable")}
            disabled={selectedUsers.length === 0}
            className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            Deshabilitar seleccionados
          </button>
          <button
            onClick={() => handleUserAction("enable")}
            disabled={selectedUsers.length === 0}
            className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            Habilitar seleccionados
          </button>
        </div>
      </div>

      {showConfirm && (
        <ModalOverlay open onClose={() => setShowConfirm(false)}>
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h3 className="text-lg font-bold mb-4">Confirmar acción</h3>
          <p className="text-gray-600 mb-6">
            ¿Estás seguro de que deseas {confirmAction === "disable" ? "deshabilitar" : "habilitar"} a {selectedUsers.length} usuario(s)?
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowConfirm(false)}
              className="px-4 py-2 border border-gray-200 rounded-md hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              onClick={confirmActionHandler}
              className={`px-4 py-2 text-white rounded-md ${confirmAction === "disable" ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}`}
            >
              Confirmar
            </button>
          </div>
        </div>
      </ModalOverlay>
      )}
    </div>
  );
}