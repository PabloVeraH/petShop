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

  let query = supabase
    .from("productos")
    .select("id, store_id, nombre, sku, precio, stock, stock_minimo")
    .eq("store_id", user.store_id)
    .eq("activo", true)
    .gt("stock", 0);

  if (search.trim()) {
    query = query.or(`nombre.ilike.%${search}%,sku.ilike.%${search}%`);
  }

  const { data, error } = await query.limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users")
    .select("store_id")
    .eq("clerk_id", userId)
    .single();
  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

  const body = await req.json();
  const { nombre, sku, precio, costo, stock, stock_minimo, marca, peso_gramos } = body;

  if (!nombre?.trim()) return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  if (!sku?.trim()) return NextResponse.json({ error: "SKU requerido" }, { status: 400 });
  if (!precio || Number(precio) <= 0) return NextResponse.json({ error: "Precio inválido" }, { status: 400 });

  const { data, error } = await supabase
    .from("productos")
    .insert({
      store_id: user.store_id,
      nombre: nombre.trim(),
      sku: sku.trim().toUpperCase(),
      precio: Number(precio),
      costo: costo ? Number(costo) : null,
      stock: Number(stock ?? 0),
      stock_minimo: Number(stock_minimo ?? 0),
      marca: marca?.trim() || null,
      peso_gramos: peso_gramos ? Number(peso_gramos) : null,
      activo: true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "El SKU ya existe" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
