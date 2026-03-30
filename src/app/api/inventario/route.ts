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
    .select("id, nombre, sku, precio, costo, stock, stock_minimo, marca, peso_gramos")
    .eq("store_id", store_id)
    .eq("activo", true)
    .order("nombre");

  if (search) {
    // Sanitize to prevent PostgREST filter string manipulation
    const s = search.replace(/[()%,]/g, "");
    query = query.or(`nombre.ilike.%${s}%,sku.ilike.%${s}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const productos = data ?? [];
  const result = soloAlertas
    ? productos.filter((p) => p.stock <= p.stock_minimo)
    : productos;

  return NextResponse.json(result);
}
