"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import KPICard from "./KPICard";
import TopProductos from "./TopProductos";
import UltimasVentas from "./UltimasVentas";
import AlertasConsumo from "./AlertasConsumo";
import SugerenciasRecompra from "./SugerenciasRecompra";
import VentasPorCanal from "./VentasPorCanal";
import VentasPorProcedencia from "./VentasPorProcedencia";

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

type LoteDashboard = {
  id: string;
  producto_id: string;
  numero_lote: string | null;
  cantidad_actual: number;
  fecha_vencimiento: string;
  producto: { id: string; nombre: string; sku: string; dias_alerta_expira?: number };
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

async function getStockAlertas(): Promise<{ total: number; items: StockAlerta[] }> {
  const res = await fetch("/api/dashboard/stock-alertas");
  if (!res.ok) return { total: 0, items: [] };
  return res.json();
}

async function getVencimientos() {
  const res = await fetch("/api/dashboard/vencimientos");
  if (!res.ok) return { vencidos: [], proximos: [], totalUnidadesVencidas: 0 };
  return res.json();
}

export default function AnaliticaTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: getDashboardData,
    refetchInterval: 60_000,
  });

  const { data: stockAlertas = { total: 0, items: [] } } = useQuery({
    queryKey: ["stock-alertas"],
    queryFn: getStockAlertas,
    refetchInterval: 60_000,
  });

  const {
    data: vencData,
    isLoading: vencLoading,
    isError: vencError,
  } = useQuery({
    queryKey: ["vencimientos"],
    queryFn: getVencimientos,
    refetchInterval: 60_000,
  });

  const [vencimientoTab, setVencimientoTab] = useState<"producto" | "lote">("producto");

  if (isLoading) {
    return <p className="text-sm text-gray-400">Cargando...</p>;
  }

  if (error) {
    return <p className="text-sm text-red-500">Error al cargar el dashboard</p>;
  }

  return (
    <div className="space-y-6">
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

      {/* Procedencia */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Procedencia de ventas hoy</CardTitle>
          </CardHeader>
          <CardContent>
            <VentasPorProcedencia data={data?.ventasPorProcedencia ?? []} />
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
            {stockAlertas.total > 0 && (
              <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                {stockAlertas.total}
              </span>
            )}
          </h2>
          {stockAlertas.total === 0 ? (
            <p className="text-sm text-gray-400">Todo el stock sobre mínimo</p>
          ) : (
            <div className="space-y-2">
              {stockAlertas.items.map((p) => (
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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">
            Vencimientos
            {(vencData?.vencidos?.length ?? 0) > 0 && (
              <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                {vencData?.vencidos?.length} vencido{(vencData?.vencidos?.length ?? 0) !== 1 ? "s" : ""}
              </span>
            )}
            {(vencData?.proximos?.length ?? 0) > 0 && (
              <span className="ml-2 text-xs bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">
                {vencData?.proximos?.length} proximo{(vencData?.proximos?.length ?? 0) !== 1 ? "s" : ""}
              </span>
            )}
          </h2>
          {(vencData?.lotes?.vencidos?.length ?? 0) > 0 || (vencData?.lotes?.proximos?.length ?? 0) > 0 ? (
            <div className="flex gap-1 text-xs">
              <button
                onClick={() => setVencimientoTab("producto")}
                className={`px-2 py-1 rounded ${vencimientoTab === "producto" ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-600"}`}
              >
                Por producto
              </button>
              <button
                onClick={() => setVencimientoTab("lote")}
                className={`px-2 py-1 rounded ${vencimientoTab === "lote" ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-600"}`}
              >
                Por lote
              </button>
            </div>
          ) : null}
        </div>

        {vencLoading && (
          <p className="text-sm text-gray-400">Cargando...</p>
        )}

        {vencError && (
          <p className="text-sm text-red-500">Error al cargar vencimientos</p>
        )}

        {!vencLoading && !vencError && (vencData?.vencidos?.length ?? 0) === 0 && (vencData?.proximos?.length ?? 0) === 0 && (vencData?.lotes?.vencidos?.length ?? 0) === 0 && (vencData?.lotes?.proximos?.length ?? 0) === 0 && (
          <p className="text-sm text-gray-400">Sin vencimientos proximos</p>
        )}

        {!vencLoading && !vencError && vencimientoTab === "producto" && (
          <div className="space-y-4">
            {(vencData?.vencidos?.length ?? 0) > 0 && (
              <div>
                <span className="inline-block mb-2 text-xs font-semibold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                  Vencidos
                </span>
                <div className="space-y-2">
                  {vencData!.vencidos.map((p: Vencimiento) => (
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

            {(vencData?.proximos?.length ?? 0) > 0 && (
              <div>
                <span className="inline-block mb-2 text-xs font-semibold bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">
                  Proximos
                </span>
                <div className="space-y-2">
                  {vencData!.proximos.map((p: Vencimiento) => (
                    <div key={p.id} className="flex items-center justify-between text-sm">
                      <span className="truncate flex-1 mr-2 text-gray-700">{p.nombre}</span>
                      <span className="text-gray-400 mr-2 whitespace-nowrap">{p.sku}</span>
                      <span className="text-amber-600 font-medium whitespace-nowrap mr-2">
                        {p.stock} ud
                      </span>
                      <span className="text-amber-600 whitespace-nowrap">
                        vence en {p.diasRestantes} dia{p.diasRestantes !== 1 ? "s" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!vencLoading && !vencError && vencimientoTab === "lote" && (
          <div className="space-y-4">
            {(vencData?.lotes?.vencidos?.length ?? 0) > 0 && (
              <div>
                <span className="inline-block mb-2 text-xs font-semibold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                  Lotes vencidos ({vencData!.lotes.vencidos.length})
                </span>
                <div className="space-y-2">
                  {vencData!.lotes.vencidos.map((l: LoteDashboard) => {
                    const diasRestantes = Math.ceil(
                      (new Date(l.fecha_vencimiento).getTime() - new Date().getTime()) / 86400000
                    );
                    return (
                      <div key={l.id} className="flex items-center justify-between text-sm">
                        <span className="truncate flex-1 mr-2 text-gray-700">{l.producto?.nombre ?? "—"}</span>
                        <span className="text-gray-400 mr-2 whitespace-nowrap">
                          {l.numero_lote ? `#${l.numero_lote}` : "—"}
                        </span>
                        <span className="text-red-600 font-medium whitespace-nowrap mr-2">
                          {l.cantidad_actual} ud
                        </span>
                        <span className="text-red-600 whitespace-nowrap">
                          {diasRestantes === 0 ? "Vence hoy" : `Vencio hace ${Math.abs(diasRestantes)} dia${Math.abs(diasRestantes) !== 1 ? "s" : ""}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(vencData?.lotes?.proximos?.length ?? 0) > 0 && (
              <div>
                <span className="inline-block mb-2 text-xs font-semibold bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">
                  Lotes proximos ({vencData!.lotes.proximos.length})
                </span>
                <div className="space-y-2">
                  {vencData!.lotes.proximos.map((l: LoteDashboard) => {
                    const diasRestantes = Math.ceil(
                      (new Date(l.fecha_vencimiento).getTime() - new Date().getTime()) / 86400000
                    );
                    return (
                      <div key={l.id} className="flex items-center justify-between text-sm">
                        <span className="truncate flex-1 mr-2 text-gray-700">{l.producto?.nombre ?? "—"}</span>
                        <span className="text-gray-400 mr-2 whitespace-nowrap">
                          {l.numero_lote ? `#${l.numero_lote}` : "—"}
                        </span>
                        <span className="text-amber-600 font-medium whitespace-nowrap mr-2">
                          {l.cantidad_actual} ud
                        </span>
                        <span className="text-amber-600 whitespace-nowrap">
                          vence en {diasRestantes} dia{diasRestantes !== 1 ? "s" : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}