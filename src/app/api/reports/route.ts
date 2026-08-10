import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ReportsQuerySchema } from "@/lib/validation";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const qParsed = ReportsQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!qParsed.success) return NextResponse.json({ error: qParsed.error.issues[0].message }, { status: 400 });
  const { periodo, canal } = qParsed.data;
  const desde = new Date();
  desde.setDate(desde.getDate() - periodo);

  let query = supabase
    .from("ventas")
    .select("id, total, subtotal, descuento, created_at, metodo_pago, canal, procedencia, clientes(nombre)")
    .eq("store_id", store_id)
    .neq("estado", "anulada")
    .gte("created_at", desde.toISOString())
    .order("created_at");

  if (canal) {
    query = query.eq("canal", canal);
  }

  const { data: ventas } = await query;

  const { data: ventaItems } = await supabase
    .from("venta_items")
    .select("producto_id, cantidad, subtotal, productos(nombre)")
    .in("venta_id", (ventas ?? []).map((v) => v.id));

  // Ventas por día
  const ventasPorDia: Record<string, { total: number; transacciones: number }> = {};
  for (const v of ventas ?? []) {
    const dia = v.created_at.split("T")[0];
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
  const prodCounts: Record<string, { nombre: string; cantidad: number; revenue: number }> = {};
  for (const item of ventaItems ?? []) {
    if (!item.producto_id) continue;
    const prod = item.productos as unknown as { nombre: string } | null;
    if (!prodCounts[item.producto_id]) {
      prodCounts[item.producto_id] = { nombre: prod?.nombre ?? "Producto", cantidad: 0, revenue: 0 };
    }
    prodCounts[item.producto_id].cantidad += item.cantidad;
    prodCounts[item.producto_id].revenue += Number(item.subtotal);
  }
  const topProductos = Object.values(prodCounts)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Top clientes
  const clienteCounts: Record<string, { nombre: string; total: number; compras: number }> = {};
  for (const v of ventas ?? []) {
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

  // Métodos de pago breakdown
  const metodos: Record<string, number> = {};
  for (const v of ventas ?? []) {
    const m = v.metodo_pago ?? "efectivo";
    metodos[m] = (metodos[m] ?? 0) + Number(v.total);
  }

  // Ventas por canal breakdown
  const canales: Record<string, { total: number; transacciones: number }> = {};
  for (const v of ventas ?? []) {
    const c = v.canal ?? "pos";
    if (!canales[c]) canales[c] = { total: 0, transacciones: 0 };
    canales[c].total += Number(v.total);
    canales[c].transacciones += 1;
  }

  // Ventas por procedencia breakdown
  const procedencias: Record<string, { total: number; transacciones: number }> = {};
  for (const v of ventas ?? []) {
    const p = (v as { procedencia?: string }).procedencia ?? "presencial";
    if (!procedencias[p]) procedencias[p] = { total: 0, transacciones: 0 };
    procedencias[p].total += Number(v.total);
    procedencias[p].transacciones += 1;
  }

  const totalPeriodo = (ventas ?? []).reduce((s, v) => s + Number(v.total), 0);
  const totalTransacciones = ventas?.length ?? 0;

  // Predicción: promedio diario REAL del período (incluye días sin ventas).
  // Luego proyecta ese promedio a 7 días. Requiere mínimo 10 transacciones.
  // Fix 6a5e96c9: antes promediaba solo sobre días CON ventas (Object.entries(ventasPorDia)),
  // inflando la proyección ~3.8x cuando las ventas eran esporádicas.
  const MIN_VENTAS_PREDICCION = 10;
  const totalVentasCount = totalTransacciones;
  const promedioDiario = totalPeriodo / periodo;
  const prediccion7dias: number | null = totalVentasCount >= MIN_VENTAS_PREDICCION
    ? Math.round(promedioDiario * 7)
    : null;

  // Vencimientos
  const hoy = new Date().toISOString().split("T")[0];
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
    periodo: Number(periodo),
    totalPeriodo,
    totalTransacciones,
    ticketPromedio: totalTransacciones ? Math.round(totalPeriodo / totalTransacciones) : 0,
    ventasPorDia: Object.entries(ventasPorDia).sort((a, b) => a[0].localeCompare(b[0])),
    topProductos,
    topClientes,
    metodos,
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
