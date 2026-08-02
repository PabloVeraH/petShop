"use client";

import { CitasTab } from "./components/CitasTab";

export default function CitasPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">Citas</h1>
        <p className="text-sm text-gray-500">Agenda de servicios (peluquería, baño, etc.)</p>
      </div>
      <CitasTab />
    </div>
  );
}
