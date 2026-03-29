"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { UserButton, useAuth } from "@clerk/nextjs";

const navItems = [
  { href: "/pos", label: "POS", roles: ["storeWorker", "storeAdmin", "systemAdmin"] },
  { href: "/dashboard", label: "Dashboard", roles: ["storeAdmin", "systemAdmin"] },
  { href: "/customers", label: "Clientes", roles: ["storeWorker", "storeAdmin", "systemAdmin"] },
  { href: "/inventory", label: "Inventario", roles: ["storeAdmin", "systemAdmin"] },
  { href: "/sales", label: "Ventas", roles: ["storeAdmin", "systemAdmin"] },
  { href: "/vendedores", label: "Vendedores", roles: ["storeAdmin", "systemAdmin"] },
  { href: "/suppliers", label: "Proveedores", roles: ["storeAdmin", "systemAdmin"] },
  { href: "/purchases", label: "Compras", roles: ["storeAdmin", "systemAdmin"] },
  { href: "/payables", label: "Cuentas x Pagar", roles: ["storeAdmin", "systemAdmin"] },
  { href: "/reports", label: "Reportes", roles: ["storeAdmin", "systemAdmin"] },
  { href: "/settings", label: "Configuración", roles: ["storeAdmin", "systemAdmin"] },
  { href: "/admin", label: "Admin", roles: ["systemAdmin"] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { sessionClaims } = useAuth();
  const meta = sessionClaims?.publicMetadata as Record<string, boolean> | undefined;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleNav = navItems.filter((item) =>
    item.roles.some((role) => meta?.[role])
  );

  const sidebar = (
    <aside className="w-56 shrink-0 bg-white border-r border-gray-200 flex flex-col h-full">
      <div className="px-4 py-5 border-b border-gray-100 flex items-center justify-between">
        <div>
          <span className="font-bold text-green-600 text-lg">PetShop</span>
          <span className="text-xs text-gray-400 block">POS System</span>
        </div>
        {/* Close button for mobile drawer */}
        <button
          className="lg:hidden p-1 rounded hover:bg-gray-100 text-gray-500"
          onClick={() => setSidebarOpen(false)}
          aria-label="Cerrar menú"
        >
          ✕
        </button>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {visibleNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setSidebarOpen(false)}
            className={`block px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
              pathname.startsWith(item.href)
                ? "bg-green-50 text-green-700"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="px-4 py-4 border-t border-gray-100">
        <UserButton />
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Desktop sidebar — always visible on lg+ */}
      <div className="hidden lg:flex lg:flex-col lg:h-screen lg:sticky lg:top-0">
        {sidebar}
      </div>

      {/* Mobile sidebar — drawer overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative z-50 h-full">
            {sidebar}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-md hover:bg-gray-100 text-gray-600"
            aria-label="Abrir menú"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-bold text-green-600">PetShop</span>
        </div>

        <main className="flex-1 p-4 lg:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
