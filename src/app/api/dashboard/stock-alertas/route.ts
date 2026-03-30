import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";

export async function GET() {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();

  const { data: allProducts, error } = await supabase
    .from("productos")
    .select("id, nombre, sku, stock, stock_minimo")
    .eq("store_id", ctx.storeId)
    .eq("activo", true)
    .order("stock", { ascending: true });

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const alertas = (allProducts ?? []).filter(
    (p) => p.stock < (p.stock_minimo ?? 0)
  );

  return NextResponse.json(alertas.slice(0, 10));
}
