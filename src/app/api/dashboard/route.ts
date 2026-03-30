import { getStoreId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { startOfDay, endOfDay } from "date-fns";

export async function GET() {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const now = new Date();
  const dayStart = startOfDay(now).toISOString();
  const dayEnd = endOfDay(now).toISOString();

  const [ventasHoyResult, ultimasVentasResult] = await Promise.all([
    supabase
      .from("ventas")
      .select("id, total, descuento, metodo_pago")
      .eq("store_id", store_id)
      .neq("estado", "anulada")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd),
    supabase
      .from("ventas")
      .select("id, total, created_at, estado, clientes(nombre)")
      .eq("store_id", store_id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const ventasHoy = ventasHoyResult.data ?? [];
  const ultimasVentas = ultimasVentasResult.data ?? [];

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
  const totalVentasHoy = ventasHoy.reduce((sum, v) => sum + Number(v.total), 0);
  const transacciones = ventasHoy.length;
  const ticketPromedio = transacciones > 0 ? Math.round(totalVentasHoy / transacciones) : 0;

  const metodoCounts: Record<string, number> = {};
  for (const v of ventasHoy) {
    const m = v.metodo_pago ?? "efectivo";
    metodoCounts[m] = (metodoCounts[m] ?? 0) + 1;
  }
  const topMetodo = Object.entries(metodoCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";

  return NextResponse.json({
    ventasHoy: totalVentasHoy,
    transacciones,
    ticketPromedio,
    topMetodo,
    topProductos,
    ultimasVentas,
    alertas,
  });
}
