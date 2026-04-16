"use client";

import { Fragment, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type Store = {
  id: string;
  name: string;
  rut: string | null;
  email: string | null;
  phone: string | null;
  whatsapp_enabled: boolean;
  created_at: string;
  user_count: number;
};

type StoreUser = {
  clerk_id: string;
  email: string;
  store_admin: boolean;
  store_worker: boolean;
  system_admin: boolean;
  updated_at: string;
};

function RoleBadge({ user }: { user: StoreUser }) {
  if (user.system_admin)
    return <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">systemAdmin</span>;
  if (user.store_admin)
    return <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">storeAdmin</span>;
  if (user.store_worker)
    return <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">storeWorker</span>;
  return <span className="text-xs text-gray-400">sin rol</span>;
}

function StoreUsers({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"storeAdmin" | "storeWorker">("storeWorker");
  const [formMsg, setFormMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: users, isLoading } = useQuery<StoreUser[]>({
    queryKey: ["store-users", storeId],
    queryFn: () => fetch(`/api/admin/users?storeId=${storeId}`).then((r) => r.json()),
  });

  const mutation = useMutation({
    mutationFn: (body: { email: string; storeId: string; role: string }) =>
      fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error");
        return d;
      }),
    onSuccess: () => {
      setFormMsg({ ok: true, text: "Usuario asignado correctamente" });
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["store-users", storeId] });
    },
    onError: (e: Error) => {
      setFormMsg({ ok: false, text: e.message });
    },
  });

  const handleAssign = (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormMsg(null);
    mutation.mutate({ email, storeId, role });
  };

  return (
    <tr>
      <td colSpan={6} className="px-5 py-4 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-gray-600">Usuarios de esta tienda</span>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">Cerrar</button>
        </div>

        {isLoading ? (
          <p className="text-xs text-gray-400">Cargando...</p>
        ) : (
          <div className="space-y-1 mb-4">
            {(users ?? []).length === 0 && <p className="text-xs text-gray-400">Sin usuarios</p>}
            {(users ?? []).map((u) => (
              <div key={u.clerk_id} className="flex items-center gap-2 text-xs text-gray-700">
                <span className="font-medium">{u.email}</span>
                <RoleBadge user={u} />
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAssign} className="flex items-center gap-2 flex-wrap">
          <input
            type="email"
            required
            placeholder="email@usuario.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500 w-48"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "storeAdmin" | "storeWorker")}
            className="border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="storeWorker">storeWorker</option>
            <option value="storeAdmin">storeAdmin</option>
          </select>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="px-3 py-1 bg-green-600 text-white text-xs font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {mutation.isPending ? "Asignando..." : "Asignar"}
          </button>
          {formMsg && (
            <span className={`text-xs ${formMsg.ok ? "text-green-600" : "text-red-600"}`}>{formMsg.text}</span>
          )}
        </form>
      </td>
    </tr>
  );
}

export default function AdminPage() {
  const [expandedStore, setExpandedStore] = useState<string | null>(null);

  const { data: stores, isLoading, error } = useQuery<Store[]>({
    queryKey: ["admin-stores"],
    queryFn: () =>
      fetch("/api/admin/stores").then(async (r) => {
        if (!r.ok) throw new Error("Acceso denegado");
        return r.json();
      }),
  });

  if (isLoading) return <div className="text-gray-500 text-sm">Cargando...</div>;
  if (error) return <div className="text-red-500 text-sm">{(error as Error).message}</div>;

  const storeList = stores ?? [];

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Administración del sistema</h1>

      <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Tiendas registradas</h2>
          <span className="text-xs text-gray-400">{storeList.length} tienda{storeList.length !== 1 ? "s" : ""}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="px-5 py-3 font-medium">Tienda</th>
              <th className="px-5 py-3 font-medium">RUT</th>
              <th className="px-5 py-3 font-medium">Contacto</th>
              <th className="px-5 py-3 font-medium text-center">Usuarios</th>
              <th className="px-5 py-3 font-medium text-center">WhatsApp</th>
              <th className="px-5 py-3 font-medium">Creada</th>
            </tr>
          </thead>
          <tbody>
            {storeList.map((s) => (
              <Fragment key={s.id}>
                <tr
                  className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpandedStore(expandedStore === s.id ? null : s.id)}
                >
                  <td className="px-5 py-3 font-medium text-gray-800">{s.name}</td>
                  <td className="px-5 py-3 text-gray-500">{s.rut ?? "—"}</td>
                  <td className="px-5 py-3 text-gray-500">
                    <div>{s.email ?? "—"}</div>
                    {s.phone && <div className="text-xs text-gray-400">{s.phone}</div>}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
                      {s.user_count}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center">
                    {s.whatsapp_enabled
                      ? <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Activo</span>
                      : <span className="text-xs text-gray-400">—</span>
                    }
                  </td>
                  <td className="px-5 py-3 text-gray-400 text-xs">
                    {new Date(s.created_at).toLocaleDateString("es-CL")}
                  </td>
                </tr>
                {expandedStore === s.id && (
                  <StoreUsers storeId={s.id} onClose={() => setExpandedStore(null)} />
                )}
              </Fragment>
            ))}
            {storeList.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-gray-400">Sin tiendas</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
