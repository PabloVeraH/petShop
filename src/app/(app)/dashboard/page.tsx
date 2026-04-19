"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import KPICard from "./components/KPICard";
import TopProductos from "./components/TopProductos";
import UltimasVentas from "./components/UltimasVentas";
import AlertasConsumo from "./components/AlertasConsumo";
import SugerenciasRecompra from "./components/SugerenciasRecompra";
import VentasPorCanal from "./components/VentasPorCanal";

type StockAlerta = {
  id: string;
  nombre: string;
  sku: string;
  stock: number;
  stock_minimo: number;
};

type Vencimiento = {
  id: string;
  nombre: string;
  sku: string;
  stock: number;
  fecha_vencimiento: string;
  diasRestantes?: number;
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

async function getVencimientos() {
  const res = await fetch("/api/dashboard/vencimientos");
  if (!res.ok) return { vencidos: [], proximos: [], totalUnidadesVencidas: 0 };
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

  const {
    data: vencimientos,
    isLoading: vencimientosLoading,
    isError: vencimientosError,
  } = useQuery({
    queryKey: ["vencimientos"],
    queryFn: getVencimientos,
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Ventas por canal hoy</CardTitle>
          </CardHeader>
          <CardContent>
            <VentasPorCanal data={data?.ventasPorCanal ?? []} />
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

      {/* Vencimientos */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Vencimientos
          {(vencimientos?.vencidos?.length || 0) > 0 && (
            <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
              {vencimientos!.vencidos.length} vencido{vencimientos!.vencidos.length !== 1 ? "s" : ""}
            </span>
          )}
          {(vencimientos?.proximos?.length || 0) > 0 && (
            <span className="ml-2 text-xs bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">
              {vencimientos!.proximos.length} próximo{vencimientos!.proximos.length !== 1 ? "s" : ""}
            </span>
          )}
        </h2>

        {vencimientosLoading && (
          <p className="text-sm text-gray-400">Cargando...</p>
        )}

        {vencimientosError && (
          <p className="text-sm text-red-500">Error al cargar vencimientos</p>
        )}

        {!vencimientosLoading && !vencimientosError && (vencimientos?.vencidos?.length || 0) === 0 && (vencimientos?.proximos?.length || 0) === 0 && (
          <p className="text-sm text-gray-400">Sin vencimientos próximos</p>
        )}

        {!vencimientosLoading && !vencimientosError && (
          <div className="space-y-4">
            {(vencimientos?.vencidos?.length || 0) > 0 && (
              <div>
                <span className="inline-block mb-2 text-xs font-semibold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                  Vencidos
                </span>
                <div className="space-y-2">
                  {vencimientos!.vencidos.map((p: Vencimiento) => (
                    <div key={p.id} className="flex items-center justify-between text-sm">
                      <span className="truncate flex-1 mr-2 text-gray-700">{p.nombre}</span>
                      <span className="text-gray-400 mr-2 whitespace-nowrap">{p.sku}</span>
                      <span className="text-red-600 font-medium whitespace-nowrap mr-2">
                        {p.stock} ud
                      </span>
                      <span className="text-red-600 whitespace-nowrap">
                        vence {new Date(p.fecha_vencimiento).toLocaleDateString("es-CL")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(vencimientos?.proximos?.length || 0) > 0 && (
              <div>
                <span className="inline-block mb-2 text-xs font-semibold bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">
                  Proximos
                </span>
                <div className="space-y-2">
                  {vencimientos!.proximos.map((p: Vencimiento) => (
                    <div key={p.id} className="flex items-center justify-between text-sm">
                      <span className="truncate flex-1 mr-2 text-gray-700">{p.nombre}</span>
                      <span className="text-gray-400 mr-2 whitespace-nowrap">{p.sku}</span>
                      <span className="text-amber-600 font-medium whitespace-nowrap mr-2">
                        {p.stock} ud
                      </span>
                      <span className="text-amber-600 whitespace-nowrap">
                        vence en {p.diasRestantes} día{p.diasRestantes !== 1 ? "s" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
