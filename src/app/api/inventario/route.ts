import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const search = req.nextUrl.searchParams.get("search") ?? "";
  const soloAlertas = req.nextUrl.searchParams.get("alertas") === "1";

  let query = supabase
    .from("productos")
    .select("id, nombre, sku, precio, stock, stock_minimo")
    .eq("store_id", store_id)
    .eq("activo", true)
    .order("nombre");

  if (search) {
    query = query.or(`nombre.ilike.%${search}%,sku.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const productos = data ?? [];
  const result = soloAlertas
    ? productos.filter((p) => p.stock <= p.stock_minimo)
    : productos;

  return NextResponse.json(result);
}
