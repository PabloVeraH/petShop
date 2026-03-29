import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const supabase = createServiceClient();
  const search = req.nextUrl.searchParams.get("search") ?? "";

  let query = supabase
    .from("productos")
    .select("id, store_id, nombre, sku, precio, stock, stock_minimo")
    .eq("store_id", store_id)
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
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const supabase = createServiceClient();
  const body = await req.json();
  const { nombre, sku, precio, costo, stock, stock_minimo, marca, peso_gramos } = body;

  if (!nombre?.trim()) return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  if (!sku?.trim()) return NextResponse.json({ error: "SKU requerido" }, { status: 400 });
  if (!precio || Number(precio) <= 0) return NextResponse.json({ error: "Precio inválido" }, { status: 400 });

  const { data, error } = await supabase
    .from("productos")
    .insert({
      store_id,
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
