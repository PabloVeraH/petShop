"use client";

import { EncargadosTab } from "./components/EncargadosTab";

export default function EncargadosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">Encargados</h1>
        <p className="text-sm text-gray-500">Personal que atiende los servicios agendables</p>
      </div>
      <EncargadosTab />
    </div>
  );
}
