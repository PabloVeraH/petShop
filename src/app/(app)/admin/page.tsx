"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { UsuariosCard } from "@/components/admin/UsuariosCard";
import { LicenciaCard } from "@/components/admin/LicenciaCard";

type AdminRole = "systemAdmin" | "storeAdmin" | "storeWorker" | null;

type Store = {
  id: string;
  name: string;
  rut: string | null;
  email: string | null;
  phone: string | null;
  whatsapp_enabled: boolean;
  created_at: string;
  user_count: number;
  license_start_date: string | null;
  license_end_date: string | null;
  license_warning_days: number;
};

export default function AdminPage() {
  const router = useRouter();
  const { userId, sessionClaims } = useAuth();
  const [activeSection, setActiveSection] = useState<"usuarios" | "licencia">("usuarios");
  const [role, setRole] = useState<AdminRole>(null);

  // Determine role
  useEffect(() => {
    if (!userId) return;
    
    const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
    let userRole: AdminRole = null;

    if (meta?.systemAdmin) userRole = "systemAdmin";
    else if (meta?.storeAdmin) userRole = "storeAdmin";
    else if (meta?.storeWorker) userRole = "storeWorker";

    setRole(userRole);

    // Redirect if not authorized
    if (userRole !== "systemAdmin" && userRole !== "storeAdmin") {
      router.replace("/pos");
    }
  }, [userId, sessionClaims, router]);

  const { data: stores, isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["admin-stores"],
    queryFn: () =>
      fetch("/api/admin/stores").then(async (r) => {
        if (!r.ok) throw new Error("Acceso denegado");
        return r.json();
      }),
    enabled: role === "systemAdmin",
  });

  if (!userId || !role || storesLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#f8f6f1]">
        <p className="text-[#666]">Cargando...</p>
      </div>
    );
  }

  if (role !== "systemAdmin" && role !== "storeAdmin") {
    return null;
  }

  // Get the first store (single store project)
  const store = stores?.[0];

  if (!store) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#f8f6f1]">
        <p className="text-[#666]">Sin tienda asignada</p>
      </div>
    );
  }

  return (
    <AdminLayout
      role={role}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
    >
      {activeSection === "usuarios" && (
        <div>
          <h1 className="text-3xl font-bold text-[#1a5f3f] mb-6">Gestión de Usuarios</h1>
          <UsuariosCard store={store} role={role} />
        </div>
      )}

      {activeSection === "licencia" && role === "systemAdmin" && (
        <div>
          <h1 className="text-3xl font-bold text-[#1a5f3f] mb-6">Licencia y Acceso</h1>
          <LicenciaCard />
        </div>
      )}
    </AdminLayout>
  );
}
