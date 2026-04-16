"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminRole, canCreateUser, canDeleteUser } from "@/hooks/useAdminAuth";

interface StoreUser {
  clerk_id: string;
  email: string;
  store_admin: boolean;
  store_worker: boolean;
  system_admin: boolean;
  updated_at: string;
}

interface Store {
  id: string;
}

interface UsuariosCardProps {
  store: Store;
  role: AdminRole;
}

export function UsuariosCard({ store, role }: UsuariosCardProps) {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const canCreate = canCreateUser(role);
  const canDelete = canDeleteUser(role);

  const { data: users, isLoading } = useQuery<StoreUser[]>({
    queryKey: ["store-users", store.id],
    queryFn: () => fetch(`/api/admin/users?storeId=${store.id}`).then((r) => r.json()),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (clerkId: string) => {
      const res = await fetch(`/api/admin/users/${clerkId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: store.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["store-users", store.id] });
    },
  });

  return (
    <div className="bg-white rounded-lg border border-[rgba(45,52,54,0.12)] p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-[#1a5f3f] flex items-center gap-2">
          👥 Gestión de Usuarios
        </h2>
        {canCreate && (
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-3 py-1 text-sm font-medium text-white bg-[#1a5f3f] hover:bg-[#0d4730] rounded-lg transition-colors"
          >
            {showCreateForm ? "Cancelar" : "+ Crear usuario"}
          </button>
        )}
      </div>

      {/* Create User Form */}
      {showCreateForm && canCreate && (
        <CreateUserForm
          storeId={store.id}
          role={role}
          onSuccess={() => {
            setShowCreateForm(false);
            queryClient.invalidateQueries({ queryKey: ["store-users", store.id] });
          }}
        />
      )}

      {/* Users List */}
      <div className="space-y-2">
        {isLoading ? (
          <p className="text-xs text-[#999]">Cargando usuarios...</p>
        ) : (users ?? []).length === 0 ? (
          <p className="text-xs text-[#999]">Sin usuarios</p>
        ) : (
          (users ?? []).map((user) => (
            <div
              key={user.clerk_id}
              className="flex items-center justify-between p-3 rounded-lg hover:bg-[rgba(212,165,116,0.03)] border-b border-[rgba(45,52,54,0.06)] last:border-0"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-[#2d3436]">{user.email}</span>
                <RoleBadge user={user} />
              </div>
              {canDelete && (
                <button
                  onClick={() => deleteUserMutation.mutate(user.clerk_id)}
                  disabled={deleteUserMutation.isPending}
                  className="w-8 h-8 flex items-center justify-center rounded-md border border-[rgba(220,100,100,0.3)] text-[#dc6464] hover:bg-[rgba(220,100,100,0.1)] hover:border-[rgba(220,100,100,0.6)] transition-all disabled:opacity-50"
                  title="Eliminar usuario"
                >
                  ✕
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {!canCreate && (
        <p className="mt-4 text-xs text-[#999]">
          Tu rol no permite crear usuarios
        </p>
      )}
    </div>
  );
}

interface CreateUserFormProps {
  storeId: string;
  role: AdminRole;
  onSuccess: () => void;
}

function CreateUserForm({ storeId, role, onSuccess }: CreateUserFormProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    role: role === "systemAdmin" ? "storeWorker" : "storeWorker",
  });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          storeId: formData.role === "systemAdmin" ? undefined : storeId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      return data;
    },
    onSuccess: () => {
      setMessage({ ok: true, text: "Usuario creado correctamente" });
      setFormData({
        email: "",
        password: "",
        firstName: "",
        lastName: "",
        role: role === "systemAdmin" ? "storeWorker" : "storeWorker",
      });
      queryClient.invalidateQueries({ queryKey: ["store-users", storeId] });
      setTimeout(() => {
        onSuccess();
        setMessage(null);
      }, 1500);
    },
    onError: (e: Error) => {
      setMessage({ ok: false, text: e.message });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    mutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="bg-[#f8f6f1] rounded-lg p-4 mb-6 border border-[rgba(212,165,116,0.2)]">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <input
          type="email"
          required
          placeholder="Email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          className="px-3 py-2 border border-[rgba(45,52,54,0.15)] rounded-lg text-sm focus:border-[#d4a574] focus:outline-none bg-white"
        />
        <input
          type="password"
          required
          placeholder="Contraseña"
          value={formData.password}
          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          className="px-3 py-2 border border-[rgba(45,52,54,0.15)] rounded-lg text-sm focus:border-[#d4a574] focus:outline-none bg-white"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <input
          type="text"
          required
          placeholder="Nombre"
          value={formData.firstName}
          onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
          className="px-3 py-2 border border-[rgba(45,52,54,0.15)] rounded-lg text-sm focus:border-[#d4a574] focus:outline-none bg-white"
        />
        <input
          type="text"
          required
          placeholder="Apellido"
          value={formData.lastName}
          onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
          className="px-3 py-2 border border-[rgba(45,52,54,0.15)] rounded-lg text-sm focus:border-[#d4a574] focus:outline-none bg-white"
        />
      </div>

      {role === "systemAdmin" && (
        <select
          value={formData.role}
          onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
          className="w-full px-3 py-2 border border-[rgba(45,52,54,0.15)] rounded-lg text-sm focus:border-[#d4a574] focus:outline-none bg-white mb-4"
        >
          <option value="storeWorker">Operador (storeWorker)</option>
          <option value="storeAdmin">Gerente (storeAdmin)</option>
          <option value="systemAdmin">Administrador (systemAdmin)</option>
        </select>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="px-4 py-2 bg-[#1a5f3f] text-white text-sm font-medium rounded-lg hover:bg-[#0d4730] disabled:opacity-50 transition-colors"
        >
          {mutation.isPending ? "Creando..." : "Crear usuario"}
        </button>
        {message && (
          <span className={`text-sm font-medium ${message.ok ? "text-green-600" : "text-red-600"}`}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}

function RoleBadge({ user }: { user: StoreUser }) {
  if (user.system_admin) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-[rgba(26,95,63,0.1)] text-[#1a5f3f] rounded-full text-xs font-semibold">
        systemAdmin
      </span>
    );
  }
  if (user.store_admin) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-[rgba(166,124,82,0.15)] text-[#a67c52] rounded-full text-xs font-semibold">
        storeAdmin
      </span>
    );
  }
  if (user.store_worker) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-[rgba(70,130,180,0.1)] text-[#4682b4] rounded-full text-xs font-semibold">
        storeWorker
      </span>
    );
  }
  return <span className="text-xs text-[#999]">sin rol</span>;
}
