"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import type { CierreMesPreview } from "@/lib/contabilidad/cierre-mes";

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

type CierreResultado = {
  mes_cerrado: string;
  desde: string;
  hasta: string;
  numero_asientos: number;
  total_debitos: number;
  total_creditos: number;
  balanceado: boolean;
  asientos_cierre: Array<{ tipo: string; id: string }>;
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

const CANALES = [
  { label: "Todos", value: "" },
  { label: "POS", value: "pos" },
  { label: "Rappi", value: "rappi" },
  { label: "PedidosYa", value: "pedidosya" },
  { label: "Uber Eats", value: "ubereats" },
];

export default function ContabilidadPage() {
  const hoy = new Date();
  const [año, setAño] = useState(String(hoy.getFullYear()));
  const [mes, setMes] = useState(String(hoy.getMonth() + 1).padStart(2, "0"));
  const [canal, setCanal] = useState("");
  const [tab, setTab] = useState<"libro" | "balance" | "resultado">("libro");
  const [showCierreConfirm, setShowCierreConfirm] = useState(false);
  const [cierreResult, setCierreResult] = useState<CierreResultado | null>(null);
  const [cierreError, setCierreError] = useState<string | null>(null);
  const [asientoToDelete, setAsientoToDelete] = useState<{ id: string; numero: number } | null>(null);
  const queryClient = useQueryClient();

  const params = mes ? `mes=${Number(mes)}&año=${año}` : `año=${año}`;

  const { data: libro, isLoading: loadingLibro } = useQuery<LibroDiarioResumen>({
    queryKey: ["libro-diario", año, mes, canal],
    queryFn: () => {
      const url = `/api/contabilidad/libro-diario?mes=${Number(mes)}&año=${año}${canal ? `&canal=${canal}` : ""}`;
      return fetch(url).then((r) => r.json());
    },
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

  const { data: preview, isLoading: loadingPreview, error: previewError } = useQuery<CierreMesPreview>({
    queryKey: ["cierre-mes-preview", año, mes],
    queryFn: async () => {
      const r = await fetch(`/api/contabilidad/cierre-mes/preview?mes=${Number(mes)}&año=${Number(año)}&calcular_costo_venta=true`);
      if (!r.ok) throw new Error("Error al obtener vista previa");
      return r.json();
    },
    enabled: showCierreConfirm && !!mes,
    staleTime: 30000,
  });

  const { mutate: eliminarAsiento, isPending: eliminandoAsiento } = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/contabilidad/asientos/${id}`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Error al eliminar el asiento");
      return data;
    },
    onSuccess: () => {
      setAsientoToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["libro-diario"] });
    },
  });

  const { mutate: cierreMes, isPending: cerrandoMes } = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/contabilidad/cierre-mes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes: Number(mes), año: Number(año), calcular_costo_venta: true }),
      });
      const data = await r.json();
      if (!r.ok) {
        const err = new Error(data.error ?? "Error al cerrar el mes");
        (err as any).status = r.status;
        throw err;
      }
      return data as CierreResultado;
    },
    onSuccess: (data) => {
      setCierreResult(data);
      setCierreError(null);
      setShowCierreConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["libro-diario"] });
      queryClient.invalidateQueries({ queryKey: ["balance-prueba"] });
    },
    onError: (err: Error) => {
      setCierreError(err.message);
      setCierreResult(null);
      setShowCierreConfirm(false);
      if ((err as any).status === 409) {
        queryClient.invalidateQueries({ queryKey: ["libro-diario"] });
        queryClient.invalidateQueries({ queryKey: ["balance-prueba"] });
      }
    },
  });

  const periodoCerrado = useMemo(() => {
    return (libro?.asientos ?? []).some(a => a.tipo_movimiento === "CIERRE_MES");
  }, [libro]);

  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {tab === "libro" ? "Libro Diario" : tab === "balance" ? "Balance de Comprobación" : "Estado de Resultado"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Registro contable conforme normativa SII Chile
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCierreResult(null);
                setCierreError(null);
                setShowCierreConfirm(true);
              }}
              disabled={cerrandoMes || !mes || periodoCerrado}
            >
              {cerrandoMes ? "Cerrando..." : "Cierre de Mes"}
            </Button>
            {periodoCerrado && (
              <span className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded border border-green-200">
                ✓ Cerrado
              </span>
            )}
          </div>
          {tab === "libro" && (
            <>
              <a
                href={`/api/contabilidad/libro-diario/pdf?mes=${Number(mes)}&año=${año}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm">PDF</Button>
              </a>
              <a href={`/api/contabilidad/libro-diario/excel?mes=${Number(mes)}&año=${año}`}>
                <Button variant="outline" size="sm">Excel</Button>
              </a>
            </>
          )}
          {tab === "balance" && (
            <>
              <a
                href={`/api/contabilidad/balance-prueba/pdf?fecha=${año}-${mes}-${new Date(Number(año), Number(mes), 0).getDate()}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm">PDF</Button>
              </a>
              <a
                href={`/api/contabilidad/balance-prueba/excel?mes=${Number(mes)}&año=${año}&fecha=${año}-${mes}-${new Date(Number(año), Number(mes), 0).getDate()}`}
              >
                <Button variant="outline" size="sm">Excel</Button>
              </a>
            </>
          )}
          {tab === "resultado" && (
            <>
              <a
                href={`/api/contabilidad/estado-resultado/pdf?mes=${Number(mes)}&año=${año}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm">PDF</Button>
              </a>
              <a href={`/api/contabilidad/estado-resultado/excel?mes=${Number(mes)}&año=${año}`}>
                <Button variant="outline" size="sm">Excel</Button>
              </a>
            </>
          )}
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
        <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Canal</label>
            <select
              value={canal}
              onChange={(e) => setCanal(e.target.value)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {CANALES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
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
                    <div className="text-xs text-gray-500">Asientos en período</div>
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
                              {a.esta_balanceado && (Number(a.total_debito) > 0 || Number(a.total_credito) > 0) ? (
                                <span className="text-green-600 font-bold">✓</span>
                              ) : a.esta_balanceado ? (
                                <span className="inline-flex items-center gap-1">
                                  <span className="text-amber-500 font-bold" title="Asiento sin movimiento económico ($0/$0)">⚠</span>
                                  <button
                                    onClick={() => setAsientoToDelete({ id: a.id, numero: a.numero_asiento })}
                                    className="text-xs text-red-500 hover:text-red-700 hover:underline"
                                    title="Eliminar asiento inválido"
                                  >
                                    Eliminar
                                  </button>
                                </span>
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
      {/* Banners de resultado cierre */}
      {cierreResult && (
        <div className="fixed bottom-6 right-6 z-50 bg-white border border-green-300 rounded-lg shadow-lg p-5 max-w-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-green-700 font-bold text-sm">✓ Cierre realizado</span>
            <button
              onClick={() => setCierreResult(null)}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
          <p className="text-sm text-gray-700">
            Período <strong>{cierreResult.mes_cerrado}</strong> cerrado correctamente.
          </p>
          <div className="text-xs text-gray-500 space-y-0.5">
            <div>Asientos procesados: <strong>{cierreResult.numero_asientos}</strong></div>
            <div>Balance: <strong className={cierreResult.balanceado ? "text-green-700" : "text-red-600"}>
              {cierreResult.balanceado ? "Cuadrado ✓" : "Descuadrado ✗"}
            </strong></div>
            {cierreResult.asientos_cierre.length > 0 && (
              <div>Asientos de cierre generados: <strong>{cierreResult.asientos_cierre.length}</strong></div>
            )}
          </div>
        </div>
      )}

      {cierreError && (
        <div className="fixed bottom-6 right-6 z-50 bg-white border border-red-300 rounded-lg shadow-lg p-5 max-w-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-red-700 font-bold text-sm">✗ Error en el cierre</span>
            <button
              onClick={() => setCierreError(null)}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
          <p className="text-sm text-gray-700">{cierreError}</p>
        </div>
      )}

      {/* Modal confirmación eliminar asiento $0/$0 */}
      {asientoToDelete && (
        <ModalOverlay open onClose={() => setAsientoToDelete(null)}>
        <div className="bg-white rounded-lg max-w-sm w-full shadow-xl m-4">
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="text-red-500 text-2xl leading-none">⚠</div>
                <div>
                  <h2 className="font-bold text-gray-900">Eliminar asiento inválido</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    El asiento <strong>#{asientoToDelete!.numero}</strong> no contiene movimiento
                    económico ($0/$0) y no tiene validez contable.
                  </p>
                </div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-md p-3 text-xs text-red-700">
                Esta acción elimina el asiento y sus líneas de detalle de forma permanente.
                Solo es posible para asientos con débito $0 y crédito $0.
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setAsientoToDelete(null)}
                  disabled={eliminandoAsiento}
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => eliminarAsiento(asientoToDelete!.id)}
                  disabled={eliminandoAsiento}
                >
                  {eliminandoAsiento ? "Eliminando..." : "Sí, eliminar"}
                </Button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Modal confirmación cierre de mes — con vista previa */}
      {showCierreConfirm && (
        <ModalOverlay open onClose={() => setShowCierreConfirm(false)}>
        <div className="bg-white rounded-lg max-w-md w-full shadow-xl m-4">
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="text-amber-500 text-2xl leading-none">⚠</div>
                <div>
                  <h2 className="font-bold text-gray-900">Confirmar Cierre de Mes</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Estás por ejecutar el cierre contable del período{" "}
                    <strong>{periodoLabel(año, mes)}</strong>.
                  </p>
                </div>
              </div>

              {/* Vista previa del cierre */}
              {loadingPreview && (
                <div className="bg-gray-50 border border-gray-200 rounded-md p-4 text-sm text-gray-500 text-center">
                  Cargando vista previa...
                </div>
              )}

              {previewError && !loadingPreview && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-800">
                  No se pudo cargar la vista previa. Puedes continuar sin ella.
                </div>
              )}

              {preview?.ya_tiene_cierre && !loadingPreview && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700 space-y-1">
                  <p className="font-medium">⚠ Este período ya está cerrado</p>
                  <p className="text-xs">
                    El período <strong>{periodoLabel(año, mes)}</strong> ya tiene un asiento de
                    cierre registrado (verificado en la vista previa). Si continúas, podrías
                    duplicar asientos contables.
                  </p>
                </div>
              )}

              {preview && !loadingPreview && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm space-y-2">
                  <p className="font-medium text-blue-800">Vista previa del período:</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-blue-700">
                    <span>Asientos en el período:</span>
                    <span className="font-bold text-right">{preview.numero_asientos}</span>
                    <span>Total Débitos:</span>
                    <span className="font-bold text-right">{fmt(preview.total_debitos)}</span>
                    <span>Total Créditos:</span>
                    <span className="font-bold text-right">{fmt(preview.total_creditos)}</span>
                    <span>Balance:</span>
                    <span className={`font-bold text-right ${preview.balanceado ? "text-green-700" : "text-red-600"}`}>
                      {preview.balanceado ? "✓ Cuadrado" : "✗ Descuadrado"}
                    </span>
                    <span>COGS a generar:</span>
                    <span className="font-bold text-right">
                      {preview.cogs_estimado > 0 ? fmt(preview.cogs_estimado) : "N/A"}
                    </span>
                    <span>Asientos de cierre:</span>
                    <span className="font-bold text-right">{preview.asientos_cierre_count}</span>
                  </div>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800 space-y-1">
                <p className="font-medium">Esta operación:</p>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                  <li>Genera el asiento de costo de ventas del período</li>
                  <li>No puede deshacerse desde la interfaz</li>
                  <li>Crea un respaldo automático del estado contable antes de ejecutarse</li>
                  <li>Quedará registrada en el log de auditoría</li>
                </ul>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowCierreConfirm(false)}
                  disabled={cerrandoMes}
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => cierreMes()}
                  disabled={cerrandoMes || periodoCerrado || !!preview?.ya_tiene_cierre}
                >
                  {cerrandoMes ? "Cerrando..." : "Confirmar cierre"}
                </Button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
