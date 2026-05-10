import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const periodo = req.nextUrl.searchParams.get("periodo") ?? "30"; // days
  const canal = req.nextUrl.searchParams.get("canal"); // optional filter
  const desde = new Date();
  desde.setDate(desde.getDate() - Number(periodo));

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
  const prodCounts: Record<string, { nombre: string; cantidad: number; revenue: number }> = {};
  for (const item of ventaItems ?? []) {
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

  // Predicción demanda: promedio diario de los últimos 7 días
  const ultimos7 = Object.entries(ventasPorDia)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-7)
    .map(([, v]) => v.total);
  const promedioDiario = ultimos7.length ? ultimos7.reduce((s, v) => s + v, 0) / ultimos7.length : 0;
  const prediccion7dias = Math.round(promedioDiario * 7);

  const totalPeriodo = (ventas ?? []).reduce((s, v) => s + Number(v.total), 0);
  const totalTransacciones = ventas?.length ?? 0;

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
}
