"use client";

import { ServiciosTab } from "./components/ServiciosTab";

export default function ServiciosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">Servicios</h1>
        <p className="text-sm text-gray-500">Configuración de servicios agendables (peluquería, baño, etc.)</p>
      </div>
      <ServiciosTab />
    </div>
  );
}