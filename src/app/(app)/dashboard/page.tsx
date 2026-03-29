"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import KPICard from "./components/KPICard";
import TopProductos from "./components/TopProductos";
import UltimasVentas from "./components/UltimasVentas";
import AlertasConsumo from "./components/AlertasConsumo";
import SugerenciasRecompra from "./components/SugerenciasRecompra";

async function getDashboardData() {
  const [dashRes, recomprasRes] = await Promise.all([
    fetch("/api/dashboard"),
    fetch("/api/recompras"),
  ]);
  if (!dashRes.ok) throw new Error("Error al cargar dashboard");
  const dashboard = await dashRes.json();
  const recompras = recomprasRes.ok ? await recomprasRes.json() : [];
  return { ...dashboard, recompras };
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: getDashboardData,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <p className="text-sm text-gray-400">Cargando...</p>;
  }

  if (error) {
    return <p className="text-sm text-red-500">Error al cargar el dashboard</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Ventas hoy"
          value={`$${Math.round(data?.ventasHoy ?? 0).toLocaleString("es-CL")}`}
        />
        <KPICard label="Transacciones" value={data?.transacciones ?? 0} />
        <KPICard
          label="Ticket promedio"
          value={`$${(data?.ticketPromedio ?? 0).toLocaleString("es-CL")}`}
        />
        <KPICard label="Método top" value={data?.topMetodo ?? "-"} />
      </div>

      {/* Widgets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Top 5 productos hoy</CardTitle>
          </CardHeader>
          <CardContent>
            <TopProductos data={data?.topProductos ?? []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Últimas ventas</CardTitle>
          </CardHeader>
          <CardContent>
            <UltimasVentas data={data?.ultimasVentas ?? []} />
          </CardContent>
        </Card>
      </div>

      {/* Alertas + Recompras */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Alertas de consumo</CardTitle>
          </CardHeader>
          <CardContent>
            <AlertasConsumo data={data?.alertas ?? []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Sugerencias de recompra</CardTitle>
          </CardHeader>
          <CardContent>
            <SugerenciasRecompra data={data?.recompras ?? []} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
