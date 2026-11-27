import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ReportsQuerySchema } from "@/lib/validation";
import { withErrorLogging } from "@/lib/audit";
import { exigirStoreAdmin } from "@/lib/admin-check";
import { fechaNegocioDeTimestamp, hoyNegocioISO, inicioPeriodo } from "@/lib/dates";
import { cargarPagosPorVenta, metodosParaAgrupar, resumenBoleta, ventasConPagos } from "@/lib/reports/pagos-reporte";
import { enLotes, leerPaginas } from "@/lib/reports/paginas";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const qParsed = ReportsQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!qParsed.success) return NextResponse.json({ error: qParsed.error.issues[0].message }, { status: 400 });
  const { periodo, canal, vendedor } = qParsed.data;
  // Ver lo vendido por una persona es solo de administradores de la tienda.
  if (vendedor) {
    const denegado = await exigirStoreAdmin(store_id);
    if (denegado) return denegado;
  }

  const desde = inicioPeriodo(periodo);
  const { data: ventas, error: errorVentas } = await leerPaginas((desdeFila, hastaFila) => {
    let query = supabase
      .from("ventas")
      .select("id, total, subtotal, descuento, created_at, metodo_pago, canal, procedencia, clientes(nombre)")
      .eq("store_id", store_id)
      .neq("estado", "anulada")
      .gte("created_at", desde);
    if (canal) query = query.eq("canal", canal);
    if (vendedor) query = query.eq("worker_clerk_id", vendedor);
    return query.order("created_at").order("id").range(desdeFila, hastaFila);
  });
  // Totales en $0 o a medias se confundirían con "no hubo ventas".
  if (errorVentas || !ventas) return NextResponse.json({ error: "Error interno" }, { status: 500 });

  // Líneas de esas ventas (ya filtradas por tienda). venta_items no tiene
  // store_id: su dueño es la venta.
  const lotesItems = await Promise.all(enLotes(ventas.map((v) => v.id)).map((ids) =>
    leerPaginas((desdeFila, hastaFila) =>
      supabase
        .from("venta_items")
        .select("venta_id, producto_id, cantidad, subtotal, productos(nombre)")
        .in("venta_id", ids)
        .order("id")
        .range(desdeFila, hastaFila)
    )
  ));
  if (lotesItems.some((l) => l.error)) return NextResponse.json({ error: "Error interno" }, { status: 500 });
  const ventaItems = lotesItems.flatMap((l) => l.data ?? []);

  // Ventas por día
  const ventasPorDia: Record<string, { total: number; transacciones: number }> = {};
  for (const v of ventas) {
    const dia = fechaNegocioDeTimestamp(v.created_at);
    if (!ventasPorDia[dia]) ventasPorDia[dia] = { total: 0, transacciones: 0 };
    ventasPorDia[dia].total += Number(v.total);
    ventasPorDia[dia].transacciones += 1;
  }

  // Top productos
  // Excluye líneas de servicio (producto_id NULL desde migración 068 — una
  // cita pagada también genera venta_items, pero con servicio_id en vez de
  // producto_id). Sin este filtro, todas las líneas de servicio colapsaban
  // en una sola entrada falsa bajo la clave "null" con nombre genérico
  // "Producto" y el revenue de servicios distintos sumado junto — un reporte
  // "Top Servicios" separado es trabajo futuro (plan_valorServicio.md §12),
  // no algo que este reporte de productos deba absorber mal etiquetado.
  // `ventas`: ventas distintas que incluyen el producto (una venta con dos
  // líneas del mismo producto, ej. dos granel, cuenta una vez).
  const prodCounts: Record<string, { nombre: string; cantidad: number; revenue: number; ventaIds: Set<string> }> = {};
  for (const item of ventaItems) {
    if (!item.producto_id) continue;
    const prod = item.productos as unknown as { nombre: string } | null;
    if (!prodCounts[item.producto_id]) {
      prodCounts[item.producto_id] = { nombre: prod?.nombre ?? "Producto", cantidad: 0, revenue: 0, ventaIds: new Set() };
    }
    prodCounts[item.producto_id].cantidad += item.cantidad;
    prodCounts[item.producto_id].revenue += Number(item.subtotal);
    prodCounts[item.producto_id].ventaIds.add(item.venta_id);
  }
  const topProductos = Object.values(prodCounts)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map(({ ventaIds, ...p }) => ({ ...p, ventas: ventaIds.size }));

  // Top clientes
  const clienteCounts: Record<string, { nombre: string; total: number; compras: number }> = {};
  for (const v of ventas) {
    const cliente = v.clientes as unknown as { nombre: string } | null;
    if (!cliente) continue;
    const key = cliente.nombre;
    if (!clienteCounts[key]) clienteCounts[key] = { nombre: key, total: 0, compras: 0 };
    clienteCounts[key].total += Number(v.total);
    clienteCounts[key].compras += 1;
  }
  const topClientes = Object.values(clienteCounts)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // Métodos de pago breakdown: una venta mixta se reparte entre sus métodos
  // reales (tabla pagos); el resto sigue por ventas.metodo_pago.
  const pagosPorVenta = await cargarPagosPorVenta(supabase, store_id, ventasConPagos(ventas));
  // metodosVentas: ventas por método; una mixta cuenta una vez en cada uno de
  // sus métodos (misma regla que /api/dashboard).
  const metodos: Record<string, number> = {};
  const metodosVentas: Record<string, number> = {};
  for (const v of ventas) {
    const pagos = metodosParaAgrupar(v, pagosPorVenta);
    for (const p of pagos) {
      metodos[p.metodo] = (metodos[p.metodo] ?? 0) + p.monto;
    }
    for (const m of new Set(pagos.map((p) => p.metodo))) metodosVentas[m] = (metodosVentas[m] ?? 0) + 1;
  }
  const { montoBoleta, boletaPorMetodo } = resumenBoleta(ventas, pagosPorVenta);

  // Ventas por canal breakdown
  const canales: Record<string, { total: number; transacciones: number }> = {};
  for (const v of ventas) {
    const c = v.canal ?? "pos";
    if (!canales[c]) canales[c] = { total: 0, transacciones: 0 };
    canales[c].total += Number(v.total);
    canales[c].transacciones += 1;
  }

  // Ventas por procedencia breakdown
  const procedencias: Record<string, { total: number; transacciones: number }> = {};
  for (const v of ventas) {
    const p = (v as { procedencia?: string }).procedencia ?? "presencial";
    if (!procedencias[p]) procedencias[p] = { total: 0, transacciones: 0 };
    procedencias[p].total += Number(v.total);
    procedencias[p].transacciones += 1;
  }

  const totalPeriodo = ventas.reduce((s, v) => s + Number(v.total), 0);
  const totalTransacciones = ventas.length;

  // Predicción: promedio diario REAL del período (incluye días sin ventas).
  // Luego proyecta ese promedio a 7 días. Requiere mínimo 10 transacciones.
  // Fix 6a5e96c9: antes promediaba solo sobre días CON ventas (Object.entries(ventasPorDia)),
  // inflando la proyección ~3.8x cuando las ventas eran esporádicas.
  const MIN_VENTAS_PREDICCION = 10;
  const totalVentasCount = totalTransacciones;
  // "Hoy" es un día a medias: no sirve para proyectar.
  const promedioDiario = totalPeriodo / (periodo === "hoy" ? 1 : periodo);
  const prediccion7dias: number | null = periodo !== "hoy" && totalVentasCount >= MIN_VENTAS_PREDICCION
    ? Math.round(promedioDiario * 7)
    : null;

  // Vencimientos
  const hoy = hoyNegocioISO();
  const { data: productosConVencimiento } = await supabase
    .from("productos")
    .select("id, nombre, sku, stock, fecha_vencimiento, dias_alerta_expira")
    .eq("store_id", store_id)
    .eq("activo", true)
    .not("fecha_vencimiento", "is", null);

  const productoData = productosConVencimiento ?? [];
  const vencidosReport = productoData.filter((p) => p.fecha_vencimiento < hoy && p.stock > 0);
  const proximosReport = productoData
    .map((p) => {
      const diasRestantes = Math.ceil(
        (new Date(p.fecha_vencimiento).getTime() - new Date(hoy).getTime()) / 86400000
      );
      return { ...p, diasRestantes };
    })
    .filter((p) => {
      if (p.fecha_vencimiento < hoy) return false;
      return p.diasRestantes <= p.dias_alerta_expira && p.stock > 0;
    });

  const { data: lotesData } = await supabase
    .from("lotes_producto")
    .select("*, producto:productos(id, nombre, sku, dias_alerta_expira)")
    .eq("store_id", store_id)
    .eq("activo", true)
    .gt("cantidad_actual", 0)
    .order("fecha_vencimiento", { ascending: true });

  const lotesVencidos = (lotesData ?? []).filter((l) => l.fecha_vencimiento < hoy);
  const lotesProximos = (lotesData ?? []).filter((l) => {
    if (l.fecha_vencimiento < hoy) return false;
    const diasRestantes = Math.ceil(
      (new Date(l.fecha_vencimiento).getTime() - new Date(hoy).getTime()) / 86400000
    );
    const diasAlerta = (l.producto as { dias_alerta_expira?: number } | null)?.dias_alerta_expira ?? 30;
    return diasRestantes <= diasAlerta;
  });

  const porProducto: Record<string, { producto_id: string; nombre: string; lotes: typeof lotesVencidos }> = {};
  for (const lote of [...lotesVencidos, ...lotesProximos]) {
    const prod = lote.producto as { id: string; nombre: string } | null;
    if (!prod) continue;
    if (!porProducto[prod.id]) porProducto[prod.id] = { producto_id: prod.id, nombre: prod.nombre, lotes: [] };
    porProducto[prod.id].lotes.push(lote);
  }

  return NextResponse.json({
    periodo,
    totalPeriodo,
    totalTransacciones,
    ticketPromedio: totalTransacciones ? Math.round(totalPeriodo / totalTransacciones) : 0,
    ventasPorDia: Object.entries(ventasPorDia).sort((a, b) => a[0].localeCompare(b[0])),
    topProductos,
    topClientes,
    metodos,
    metodosVentas,
    montoBoleta,
    boletaPorMetodo,
    canales,
    procedencias,
    prediccion7dias,
    promedioDiario: Math.round(promedioDiario),
    vencimientos: {
      vencidos: vencidosReport,
      proximos: proximosReport,
      totalUnidadesVencidas: vencidosReport.reduce((sum, p) => sum + p.stock, 0),
    },
    lotes_vencimientos: {
      vencidos: lotesVencidos,
      proximos: lotesProximos,
      totalUnidadesVencidas: lotesVencidos.reduce((s, l) => s + l.cantidad_actual, 0),
      totalUnidadesProximas: lotesProximos.reduce((s, l) => s + l.cantidad_actual, 0),
      porProducto: Object.values(porProducto),
    },
  });
}, { endpoint: "GET /api/reports" });
