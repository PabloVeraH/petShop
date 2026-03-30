"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import KPICard from "./components/KPICard";
import TopProductos from "./components/TopProductos";
import UltimasVentas from "./components/UltimasVentas";
import AlertasConsumo from "./components/AlertasConsumo";
import SugerenciasRecompra from "./components/SugerenciasRecompra";

type StockAlerta = {
  id: string;
  nombre: string;
  sku: string;
  stock: number;
  stock_minimo: number;
};

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

async function getStockAlertas(): Promise<StockAlerta[]> {
  const res = await fetch("/api/dashboard/stock-alertas");
  if (!res.ok) return [];
  return res.json();
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: getDashboardData,
    refetchInterval: 60_000,
  });

  const { data: alertasStock = [] } = useQuery({
    queryKey: ["stock-alertas"],
    queryFn: getStockAlertas,
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

      {/* Stock bajo mínimo */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Stock bajo mínimo
            {alertasStock.length > 0 && (
              <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                {alertasStock.length}
              </span>
            )}
          </h2>
          {alertasStock.length === 0 ? (
            <p className="text-sm text-gray-400">Todo el stock sobre mínimo</p>
          ) : (
            <div className="space-y-2">
              {alertasStock.map((p) => (
                <div key={p.id} className="flex justify-between items-center text-sm">
                  <span className="truncate flex-1 mr-2 text-gray-700">{p.nombre}</span>
                  <span className="text-red-600 font-medium whitespace-nowrap">
                    {p.stock} / {p.stock_minimo}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
