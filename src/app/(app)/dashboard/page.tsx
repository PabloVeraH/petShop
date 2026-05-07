"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TabBar } from "./components/TabBar";
import AnaliticaTab from "./components/AnaliticaTab";
import ReportesTab from "./components/ReportesTab";

type DashboardTab = "analitica" | "reportes";

function DashboardContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as DashboardTab) ?? "analitica";
  const [activeTab, setActiveTab] = useState<DashboardTab>(initialTab);

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-4">Analítica</h1>
      <TabBar active={activeTab} onChange={setActiveTab} />
      {activeTab === "analitica" && <AnaliticaTab />}
      {activeTab === "reportes" && <ReportesTab />}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400">Cargando...</p>}>
      <DashboardContent />
    </Suspense>
  );
}