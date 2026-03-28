"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useAuth } from "@clerk/nextjs";

const navItems = [
  { href: "/pos", label: "POS", roles: ["storeWorker", "storeAdmin", "systemAdmin"] },
  { href: "/dashboard", label: "Dashboard", roles: ["storeAdmin", "systemAdmin"] },
  { href: "/customers", label: "Clientes", roles: ["storeWorker", "storeAdmin", "systemAdmin"] },
  { href: "/inventory", label: "Inventario", roles: ["storeAdmin", "systemAdmin"] },
  { href: "/sales", label: "Ventas", roles: ["storeAdmin", "systemAdmin"] },
  { href: "/admin", label: "Admin", roles: ["systemAdmin"] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { sessionClaims } = useAuth();
  const meta = sessionClaims?.publicMetadata as Record<string, boolean> | undefined;

  const visibleNav = navItems.filter((item) =>
    item.roles.some((role) => meta?.[role])
  );

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-100">
          <span className="font-bold text-green-600 text-lg">PetShop</span>
          <span className="text-xs text-gray-400 block">POS System</span>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          {visibleNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
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

      {/* Main content */}
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  );
}
