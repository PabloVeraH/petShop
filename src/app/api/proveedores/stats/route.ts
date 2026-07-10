import { getStoreId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET() {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const [ordenesRes, cuentasRes] = await Promise.all([
    supabase
      .from("ordenes_compra")
      .select("proveedor_id")
      .eq("store_id", store_id)
      .neq("estado", "cancelada"),
    supabase
      .from("cuentas_pagar")
      .select("proveedor_id, monto")
      .eq("store_id", store_id)
      .eq("estado", "pendiente")
      .gt("monto", 0),
  ]);

  if (ordenesRes.error || cuentasRes.error) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const orderCounts: Record<string, number> = {};
  for (const o of ordenesRes.data ?? []) {
    orderCounts[o.proveedor_id] = (orderCounts[o.proveedor_id] ?? 0) + 1;
  }

  const payableCounts: Record<string, number> = {};
  const payableAmounts: Record<string, number> = {};
  for (const c of cuentasRes.data ?? []) {
    payableCounts[c.proveedor_id] = (payableCounts[c.proveedor_id] ?? 0) + 1;
    payableAmounts[c.proveedor_id] = (payableAmounts[c.proveedor_id] ?? 0) + Number(c.monto);
  }

  return NextResponse.json({ orderCounts, payableCounts, payableAmounts });
}
