import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users")
    .select("store_id")
    .eq("clerk_id", userId)
    .single();

  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

  const search = req.nextUrl.searchParams.get("search") ?? "";
  const soloAlertas = req.nextUrl.searchParams.get("alertas") === "1";

  let query = supabase
    .from("productos")
    .select("id, nombre, sku, precio, stock, stock_minimo")
    .eq("store_id", user.store_id)
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
