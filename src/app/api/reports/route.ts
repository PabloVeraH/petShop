import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const periodo = req.nextUrl.searchParams.get("periodo") ?? "30"; // days
  const desde = new Date();
  desde.setDate(desde.getDate() - Number(periodo));

  const { data: ventas } = await supabase
    .from("ventas")
    .select("id, total, subtotal, descuento, created_at, metodo_pago, clientes(nombre)")
    .eq("store_id", store_id)
    .neq("estado", "anulada")
    .gte("created_at", desde.toISOString())
    .order("created_at");

  const { data: ventaItems } = await supabase
    .from("venta_items")
    .select("producto_id, cantidad, subtotal, productos(nombre)")
    .in("venta_id", (ventas ?? []).map((v) => v.id));

  // Ventas por día
  const ventasPorDia: Record<string, number> = {};
  for (const v of ventas ?? []) {
    const dia = v.created_at.split("T")[0];
    ventasPorDia[dia] = (ventasPorDia[dia] ?? 0) + Number(v.total);
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

  // Predicción demanda: promedio diario de los últimos 7 días
  const ultimos7 = Object.entries(ventasPorDia)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-7)
    .map(([, v]) => v);
  const promedioDiario = ultimos7.length ? ultimos7.reduce((s, v) => s + v, 0) / ultimos7.length : 0;
  const prediccion7dias = Math.round(promedioDiario * 7);

  const totalPeriodo = (ventas ?? []).reduce((s, v) => s + Number(v.total), 0);
  const totalTransacciones = ventas?.length ?? 0;

  return NextResponse.json({
    periodo: Number(periodo),
    totalPeriodo,
    totalTransacciones,
    ticketPromedio: totalTransacciones ? Math.round(totalPeriodo / totalTransacciones) : 0,
    ventasPorDia: Object.entries(ventasPorDia).sort((a, b) => a[0].localeCompare(b[0])),
    topProductos,
    topClientes,
    metodos,
    prediccion7dias,
    promedioDiario: Math.round(promedioDiario),
  });
}
