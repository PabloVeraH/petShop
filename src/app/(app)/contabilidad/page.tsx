"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

type Asiento = {
  id: string;
  numero_asiento: number;
  fecha: string;
  tipo_movimiento?: string;
  referencia_numero?: string;
  descripcion: string;
  total_debito: number;
  total_credito: number;
  esta_balanceado: boolean;
};

type LibroDiarioResumen = {
  periodo: string;
  desde: string;
  hasta: string;
  empresa: { nombre: string; rut: string };
  asientos: Asiento[];
  resumen: {
    total_asientos: number;
    total_debitos: number;
    total_creditos: number;
    balanceado: boolean;
  };
};

const TIPOS_COLOR: Record<string, string> = {
  VENTA: "bg-green-100 text-green-700",
  NOTA_CREDITO: "bg-orange-100 text-orange-700",
  COMPRA: "bg-blue-100 text-blue-700",
  PAGO_PROVEEDOR: "bg-purple-100 text-purple-700",
  AJUSTE: "bg-gray-100 text-gray-700",
  CIERRE_MES: "bg-red-100 text-red-700",
};

function fmt(n: number) {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function periodoLabel(año: string, mes: string) {
  if (!mes) return año;
  return new Date(Number(año), Number(mes) - 1, 1).toLocaleString("es-CL", {
    month: "long",
    year: "numeric",
  });
}

export default function ContabilidadPage() {
  const hoy = new Date();
  const [año, setAño] = useState(String(hoy.getFullYear()));
  const [mes, setMes] = useState(String(hoy.getMonth() + 1).padStart(2, "0"));
  const [tab, setTab] = useState<"libro" | "balance" | "resultado">("libro");
  const [planCargado, setPlanCargado] = useState(false);
  const queryClient = useQueryClient();

  const params = mes ? `mes=${Number(mes)}&año=${año}` : `año=${año}`;

  const { data: libro, isLoading: loadingLibro } = useQuery<LibroDiarioResumen>({
    queryKey: ["libro-diario", año, mes],
    queryFn: () =>
      fetch(`/api/contabilidad/libro-diario?mes=${Number(mes)}&año=${año}`).then((r) => r.json()),
  });

  const { data: balance, isLoading: loadingBalance } = useQuery({
    queryKey: ["balance-prueba", año, mes],
    queryFn: () => {
      const hasta = mes
        ? `${año}-${mes.padStart(2, "0")}-${new Date(Number(año), Number(mes), 0).getDate()}`
        : `${año}-12-31`;
      return fetch(`/api/contabilidad/balance-prueba?fecha=${hasta}`).then((r) => r.json());
    },
    enabled: tab === "balance",
  });

  const { data: resultado, isLoading: loadingResultado } = useQuery({
    queryKey: ["estado-resultado", año, mes],
    queryFn: () =>
      fetch(`/api/contabilidad/estado-resultado?${params}`).then((r) => r.json()),
    enabled: tab === "resultado",
  });

  const { mutate: cargarPlan, isPending: cargandoPlan } = useMutation({
    mutationFn: () =>
      fetch("/api/contabilidad/plan-cuentas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cargar_plan_base" }),
      }).then((r) => r.json()),
    onSuccess: () => setPlanCargado(true),
  });

  const { mutate: cierreMes, isPending: cerrandoMes } = useMutation({
    mutationFn: () =>
      fetch("/api/contabilidad/cierre-mes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes: Number(mes), año: Number(año), calcular_costo_venta: true }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["libro-diario"] });
      queryClient.invalidateQueries({ queryKey: ["balance-prueba"] });
    },
  });

  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Libro Diario</h1>
          <p className="text-sm text-gray-500 mt-1">
            Registro contable conforme normativa SII Chile
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => cargarPlan()}
            disabled={cargandoPlan || planCargado}
          >
            {planCargado ? "✓ Plan Cargado" : cargandoPlan ? "Cargando..." : "Cargar Plan de Cuentas"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => cierreMes()}
            disabled={cerrandoMes || !mes}
          >
            {cerrandoMes ? "Cerrando..." : "Cierre de Mes"}
          </Button>
        </div>
      </div>

      {/* Filtros período */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex gap-4 flex-wrap items-end">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Año</label>
          <select
            value={año}
            onChange={(e) => setAño(e.target.value)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {[2024, 2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Mes</label>
          <select
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {meses.map((m, i) => (
              <option key={i + 1} value={String(i + 1).padStart(2, "0")}>{m}</option>
            ))}
          </select>
        </div>
        <div className="text-sm text-gray-500">
          Período: <strong>{periodoLabel(año, mes)}</strong>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1">
          {[
            { id: "libro", label: "Libro Diario" },
            { id: "balance", label: "Balance de Comprobación" },
            { id: "resultado", label: "Estado de Resultado" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-green-600 text-green-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab: Libro Diario */}
      {tab === "libro" && (
        <div className="space-y-4">
          {loadingLibro ? (
            <div className="text-center py-12 text-gray-400">Cargando asientos...</div>
          ) : (
            <>
              {/* Resumen */}
              {libro?.resumen && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white rounded-lg border p-4">
                    <div className="text-xs text-gray-500">Total Asientos</div>
                    <div className="text-2xl font-bold text-gray-900">{libro.resumen.total_asientos}</div>
                  </div>
                  <div className="bg-white rounded-lg border p-4">
                    <div className="text-xs text-gray-500">Total Débitos</div>
                    <div className="text-xl font-bold text-blue-700">{fmt(libro.resumen.total_debitos)}</div>
                  </div>
                  <div className="bg-white rounded-lg border p-4">
                    <div className="text-xs text-gray-500">Total Créditos</div>
                    <div className="text-xl font-bold text-purple-700">{fmt(libro.resumen.total_creditos)}</div>
                  </div>
                  <div className="bg-white rounded-lg border p-4">
                    <div className="text-xs text-gray-500">Balance</div>
                    <div className={`text-xl font-bold ${libro.resumen.balanceado ? "text-green-700" : "text-red-600"}`}>
                      {libro.resumen.balanceado ? "✓ Cuadrado" : "✗ Descuadrado"}
                    </div>
                  </div>
                </div>
              )}

              {/* Tabla de asientos */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {!libro?.asientos?.length ? (
                  <div className="text-center py-16 text-gray-400">
                    <div className="text-4xl mb-3">📒</div>
                    <p className="font-medium">Sin asientos en este período</p>
                    <p className="text-sm mt-1">Los asientos se generan automáticamente con cada transacción</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-gray-600">Nro.</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600">Fecha</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600">Tipo</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-600">Descripción</th>
                          <th className="px-4 py-3 text-right font-medium text-gray-600">Débito</th>
                          <th className="px-4 py-3 text-right font-medium text-gray-600">Crédito</th>
                          <th className="px-4 py-3 text-center font-medium text-gray-600">OK</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {libro.asientos.map((a) => (
                          <tr key={a.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-mono text-gray-500">{a.numero_asiento}</td>
                            <td className="px-4 py-3 text-gray-600">
                              {new Date(a.fecha + "T12:00:00").toLocaleDateString("es-CL")}
                            </td>
                            <td className="px-4 py-3">
                              {a.tipo_movimiento && (
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TIPOS_COLOR[a.tipo_movimiento] ?? "bg-gray-100 text-gray-600"}`}>
                                  {a.tipo_movimiento.replace("_", " ")}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-800 max-w-xs">
                              <div className="truncate">{a.descripcion}</div>
                              {a.referencia_numero && (
                                <div className="text-xs text-gray-400 font-mono">{a.referencia_numero}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-blue-700 font-mono">
                              {fmt(Number(a.total_debito))}
                            </td>
                            <td className="px-4 py-3 text-right text-purple-700 font-mono">
                              {fmt(Number(a.total_credito))}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {a.esta_balanceado ? (
                                <span className="text-green-600 font-bold">✓</span>
                              ) : (
                                <span className="text-red-500 font-bold">✗</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                        <tr>
                          <td colSpan={4} className="px-4 py-3 font-bold text-gray-700 text-right">TOTALES:</td>
                          <td className="px-4 py-3 text-right font-bold text-blue-700 font-mono">
                            {fmt(libro?.resumen?.total_debitos ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-purple-700 font-mono">
                            {fmt(libro?.resumen?.total_creditos ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {libro?.resumen?.balanceado ? (
                              <span className="text-green-600 font-bold">✓</span>
                            ) : (
                              <span className="text-red-500 font-bold">✗</span>
                            )}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab: Balance de Comprobación */}
      {tab === "balance" && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {loadingBalance ? (
            <div className="text-center py-12 text-gray-400">Calculando balance...</div>
          ) : !balance?.cuentas?.length ? (
            <div className="text-center py-16 text-gray-400">
              <p className="font-medium">Sin movimientos registrados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Código</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Cuenta</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Tipo</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Débitos</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Créditos</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {balance.cuentas.map((c: { codigo: string; nombre: string; tipo: string; debitos: number; creditos: number; saldo: number }) => (
                    <tr key={c.codigo} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-gray-500">{c.codigo}</td>
                      <td className="px-4 py-3 text-gray-800">{c.nombre}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium text-gray-500">{c.tipo}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-blue-700 font-mono">{fmt(c.debitos)}</td>
                      <td className="px-4 py-3 text-right text-purple-700 font-mono">{fmt(c.creditos)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-bold ${c.saldo >= 0 ? "text-gray-800" : "text-red-600"}`}>
                        {c.saldo < 0 ? `(${fmt(Math.abs(c.saldo))})` : fmt(c.saldo)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 font-bold text-gray-700 text-right">TOTALES:</td>
                    <td className="px-4 py-3 text-right font-bold text-blue-700 font-mono">{fmt(balance.total_debitos)}</td>
                    <td className="px-4 py-3 text-right font-bold text-purple-700 font-mono">{fmt(balance.total_creditos)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${balance.balanceado ? "text-green-700" : "text-red-600"}`}>
                      {balance.balanceado ? "✓ Cuadrado" : "✗ Descuadrado"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Estado de Resultado */}
      {tab === "resultado" && (
        <div className="max-w-2xl">
          {loadingResultado ? (
            <div className="text-center py-12 text-gray-400">Calculando...</div>
          ) : resultado && (
            <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
              <div className="text-center border-b pb-4">
                <h2 className="font-bold text-gray-900">{resultado.empresa?.nombre ?? "petShop"}</h2>
                <p className="text-sm text-gray-500">Estado de Resultado — {resultado.periodo}</p>
              </div>

              {/* Ingresos */}
              <div>
                <h3 className="font-semibold text-gray-700 mb-2">INGRESOS OPERACIONALES</h3>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Venta de Productos</span>
                    <span className="font-mono">{fmt(resultado.ingresos?.venta_productos ?? 0)}</span>
                  </div>
                  {(resultado.ingresos?.devoluciones ?? 0) !== 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>(-) Devoluciones</span>
                      <span className="font-mono">{fmt(resultado.ingresos?.devoluciones ?? 0)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t pt-1 mt-2">
                    <span>Total Ingresos</span>
                    <span className="font-mono text-green-700">{fmt(resultado.ingresos?.total_ingresos_operacionales ?? 0)}</span>
                  </div>
                </div>
              </div>

              {/* Gastos */}
              <div>
                <h3 className="font-semibold text-gray-700 mb-2">GASTOS</h3>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Costo de Bienes Vendidos</span>
                    <span className="font-mono">{fmt(resultado.gastos?.costo_venta ?? 0)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-1 mt-2">
                    <span>Total Gastos</span>
                    <span className="font-mono text-red-700">{fmt(resultado.gastos?.total_gastos ?? 0)}</span>
                  </div>
                </div>
              </div>

              {/* Utilidad */}
              <div className="border-t-2 pt-4">
                <div className="flex justify-between text-lg font-bold">
                  <span>UTILIDAD NETA</span>
                  <span className={`font-mono ${(resultado.utilidad_neta ?? 0) >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {fmt(resultado.utilidad_neta ?? 0)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
