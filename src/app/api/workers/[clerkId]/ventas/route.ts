import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clerkId: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId } = ctx;
  const { clerkId } = await params;

  const desde = req.nextUrl.searchParams.get("desde");
  const hasta = req.nextUrl.searchParams.get("hasta");

  const supabase = createServiceClient();
  let query = supabase
    .from("ventas")
    .select("id, numero_comprobante, total, metodo_pago, estado, created_at, clientes(nombre)")
    .eq("store_id", storeId)
    .eq("worker_clerk_id", clerkId)
    .neq("estado", "anulada")
    .order("created_at", { ascending: false });

  if (desde) query = query.gte("created_at", new Date(desde).toISOString());
  if (hasta) {
    const hastaFin = new Date(hasta);
    hastaFin.setHours(23, 59, 59, 999);
    query = query.lte("created_at", hastaFin.toISOString());
  }

  const { data, error } = await query.limit(200);
  if (error) return NextResponse.json({ error: "Error interno" }, { status: 500 });

  // Agregar monto_devuelto por NC por cada venta
  const ids = (data ?? []).map((v) => v.id).filter(Boolean);
  const devueltoPorVenta: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: ncs } = await supabase
      .from("notas_credito")
      .select("monto_total, venta_id")
      .in("venta_id", ids);
    for (const nc of ncs ?? []) {
      devueltoPorVenta[nc.venta_id] = (devueltoPorVenta[nc.venta_id] ?? 0) + Number(nc.monto_total);
    }
  }

  const result = (data ?? []).map((v) => ({
    ...v,
    monto_devuelto: devueltoPorVenta[v.id] ?? 0,
  }));

  return NextResponse.json(result);
}