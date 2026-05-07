"use client";

import { useState } from "react";
import { AdminRole } from "@/hooks/useAdminAuth";

interface AdminLayoutProps {
  role: AdminRole;
  activeSection: "usuarios" | "licencia";
  onSectionChange: (section: "usuarios" | "licencia") => void;
  children: React.ReactNode;
}

export function AdminLayout({ role, activeSection, onSectionChange, children }: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;

  return (
    <div className="flex h-screen bg-[#f8f6f1]">
      {/* Sidebar */}
      <aside
        className={`transition-all duration-300 ${
          sidebarOpen ? "w-48" : "w-16"
        } border-r border-[rgba(45,52,54,0.08)] bg-[#f8f6f1] flex flex-col`}
      >
        {/* Logo/Header */}
        <div className="h-16 flex items-center justify-center border-b border-[rgba(45,52,54,0.08)]">
          {sidebarOpen ? (
            <h2 className="text-sm font-bold text-[#1a5f3f]">petShop</h2>
          ) : (
            <span className="text-lg">🐾</span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-6 px-3 space-y-2">
          {/* Usuarios - only for systemAdmin and storeAdmin */}
          {(role === "systemAdmin" || role === "storeAdmin") && (
            <NavItem
              icon="👥"
              label="Usuarios"
              isActive={activeSection === "usuarios"}
              onClick={() => onSectionChange("usuarios")}
              collapsed={!sidebarOpen}
            />
          )}

          {/* Licencia - only for systemAdmin */}
          {role === "systemAdmin" && (
            <NavItem
              icon="🔐"
              label="Licencia"
              isActive={activeSection === "licencia"}
              onClick={() => onSectionChange("licencia")}
              collapsed={!sidebarOpen}
            />
          )}
        </nav>

        {/* Toggle button */}
        <div className="p-3 border-t border-[rgba(45,52,54,0.08)]">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-full h-10 flex items-center justify-center rounded-md hover:bg-[rgba(212,165,116,0.1)] transition-colors"
            title={sidebarOpen ? "Collapse" : "Expand"}
          >
            {sidebarOpen ? "«" : "»"}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          <div className="max-w-4xl">{children}</div>
        </div>
      </main>
    </div>
  );
}

interface NavItemProps {
  icon: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
  collapsed: boolean;
}

function NavItem({ icon, label, isActive, onClick, collapsed }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
        isActive
          ? "bg-[rgba(212,165,116,0.08)] border-l-[3px] border-[#d4a574] text-[#1a5f3f] font-medium"
          : "text-[#2d3436] hover:bg-[rgba(212,165,116,0.05)]"
      }`}
    >
      <span className="text-lg flex-shrink-0">{icon}</span>
      {!collapsed && <span className="text-sm whitespace-nowrap">{label}</span>}
    </button>
  );
}
