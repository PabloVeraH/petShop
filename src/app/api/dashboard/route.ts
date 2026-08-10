import { getStoreId } from "@/lib/auth";
import { auth } from "@clerk/nextjs/server";
import { getAdminStatus } from "@/lib/admin-check";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { startOfDay, endOfDay } from "date-fns";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async () => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id, userId } = ctx;
  const supabase = createServiceClient();

  // Determinar si el usuario es un vendedor puro (sin rol admin)
  const { sessionClaims } = await auth();
  const adminCtx = getAdminStatus(sessionClaims);
  const isWorkerOnly = !adminCtx?.isStoreAdmin && !adminCtx?.isSystemAdmin;

  const now = new Date();
  const dayStart = startOfDay(now).toISOString();
  const dayEnd = endOfDay(now).toISOString();

  // Los vendedores solo ven sus propias ventas; admins ven toda la tienda
  let ventasHoyBase = supabase
    .from("ventas")
    .select("id, total, descuento, metodo_pago, canal, procedencia")
    .eq("store_id", store_id)
    .neq("estado", "anulada")
    .gte("created_at", dayStart)
    .lte("created_at", dayEnd);
  if (isWorkerOnly) ventasHoyBase = ventasHoyBase.eq("worker_clerk_id", userId);

  let ultimasVentasBase = supabase
    .from("ventas")
    .select("id, total, created_at, estado, canal, clientes(nombre)")
    .eq("store_id", store_id);
  if (isWorkerOnly) ultimasVentasBase = ultimasVentasBase.eq("worker_clerk_id", userId);

  const [ventasHoyResult, ultimasVentasResult] = await Promise.all([
    ventasHoyBase,
    ultimasVentasBase.order("created_at", { ascending: false }).limit(10),
  ]);

  const ventasHoy = ventasHoyResult.data ?? [];
  const ultimasVentas = ultimasVentasResult.data ?? [];

  // Descontar Notas de Crédito del total de cada venta — sin esto, una
  // venta devuelta al 100% infla "Ventas hoy", "Ventas por canal/procedencia"
  // y el ticket promedio, igual que el bug ya corregido en
  // GET /api/workers (I-425). Se calcula el neto por venta UNA vez y se
  // reutiliza en las tres agregaciones de abajo (total, canal, procedencia).
  const ventaIdsParaNC = ventasHoy.map((v) => v.id);
  const devueltoPorVenta: Record<string, number> = {};
  if (ventaIdsParaNC.length > 0) {
    const { data: ncs } = await supabase
      .from("notas_credito")
      .select("monto_total, venta_id")
      .in("venta_id", ventaIdsParaNC);
    for (const nc of ncs ?? []) {
      devueltoPorVenta[nc.venta_id] = (devueltoPorVenta[nc.venta_id] ?? 0) + Number(nc.monto_total);
    }
  }
  function totalNeto(v: { id: string; total: number }): number {
    return Math.max(0, Number(v.total) - (devueltoPorVenta[v.id] ?? 0));
  }

  // Top productos del día
  const ventaIds = ventasHoy.map((v) => v.id);
  let topProductos: { producto_id: string; nombre: string; cantidad: number }[] = [];

  if (ventaIds.length > 0) {
    const { data: items } = await supabase
      .from("venta_items")
      .select("producto_id, cantidad, productos(nombre)")
      .in("venta_id", ventaIds);

    const counts: Record<string, { nombre: string; cantidad: number }> = {};
    for (const item of items ?? []) {
      const pid = item.producto_id;
      if (!counts[pid]) {
        const prod = item.productos as unknown as { nombre: string } | null;
        counts[pid] = {
          nombre: prod?.nombre ?? "",
          cantidad: 0,
        };
      }
      counts[pid].cantidad += item.cantidad;
    }
    topProductos = Object.entries(counts)
      .sort((a, b) => b[1].cantidad - a[1].cantidad)
      .slice(0, 5)
      .map(([id, val]) => ({ producto_id: id, ...val }));
  }

  // Alertas consumo scoped a la tienda (store_id directo desde migración 005)
  const { data: alertasData } = await supabase
    .from("consumo_alertas")
    .select("id, fecha_estimada_termino, mascotas(nombre), productos(nombre), clientes(nombre)")
    .eq("store_id", store_id)
    .eq("enviado", false)
    .order("fecha_estimada_termino", { ascending: true })
    .limit(10);
  const alertas = alertasData ?? [];

  // KPIs
  const totalVentasHoy = ventasHoy.reduce((sum, v) => sum + totalNeto(v), 0);
  // Una venta 100% devuelta (neto 0) no cuenta como transacción: "Ventas hoy"
  // descuenta su monto completo (totalNeto), así que contarla como transacción
  // infla el divisor de Ticket promedio y lo distorsiona (ticket Trello
  // 6a77edec41f13cebd89d3d1e). Criterio = neto > 0 — el MISMO valor que
  // alimenta el numerador, garantizando consistencia entre ambas tarjetas.
  const transacciones = ventasHoy.filter((v) => totalNeto(v) > 0).length;
  const ticketPromedio = transacciones > 0 ? Math.round(totalVentasHoy / transacciones) : 0;

  const metodoCounts: Record<string, number> = {};
  for (const v of ventasHoy) {
    const m = v.metodo_pago ?? "efectivo";
    metodoCounts[m] = (metodoCounts[m] ?? 0) + 1;
  }
  const topMetodo = Object.entries(metodoCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";

  // Ventas por canal
  const canalCounts: Record<string, { total: number; transacciones: number }> = {};
  for (const v of ventasHoy) {
    const neto = totalNeto(v);
    if (neto <= 0) continue; // venta 100% devuelta: no aporta monto ni transacción (mismo criterio que el KPI)
    const canal = v.canal ?? "pos";
    if (!canalCounts[canal]) {
      canalCounts[canal] = { total: 0, transacciones: 0 };
    }
    canalCounts[canal].total += neto;
    canalCounts[canal].transacciones += 1;
  }
  const ventasPorCanal = Object.entries(canalCounts).map(([canal, data]) => ({
    canal,
    total: data.total,
    transacciones: data.transacciones,
  }));

  // Ventas por procedencia
  const procedenciaCounts: Record<string, { total: number; transacciones: number }> = {};
  for (const v of ventasHoy) {
    const neto = totalNeto(v);
    if (neto <= 0) continue; // venta 100% devuelta: no aporta monto ni transacción (mismo criterio que el KPI)
    const proc = (v as { procedencia?: string }).procedencia ?? "presencial";
    if (!procedenciaCounts[proc]) procedenciaCounts[proc] = { total: 0, transacciones: 0 };
    procedenciaCounts[proc].total += neto;
    procedenciaCounts[proc].transacciones += 1;
  }
  const ventasPorProcedencia = Object.entries(procedenciaCounts).map(([procedencia, data]) => ({
    procedencia,
    total: data.total,
    transacciones: data.transacciones,
  }));

  return NextResponse.json({
    ventasHoy: totalVentasHoy,
    transacciones,
    ticketPromedio,
    topMetodo,
    topProductos,
    ultimasVentas,
    alertas,
    ventasPorCanal,
    ventasPorProcedencia,
  });
}, { endpoint: "GET /api/dashboard" });
