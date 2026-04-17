import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { syncProductsToHub } from "@/lib/hub-sync";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const supabase = createServiceClient();
  const search = req.nextUrl.searchParams.get("search") ?? "";

  let query = supabase
    .from("productos")
    .select("id, store_id, nombre, sku, precio, stock, stock_minimo, fecha_vencimiento, dias_alerta, precio_oferta, en_oferta")
    .eq("store_id", store_id)
    .eq("activo", true)
    .gt("stock", 0);

  if (search.trim()) {
    // Sanitize to prevent PostgREST filter string manipulation
    const s = search.replace(/[()%,]/g, "");
    query = query.or(`nombre.ilike.%${s}%,sku.ilike.%${s}%`);
  }

  const { data, error } = await query.limit(50);
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const supabase = createServiceClient();
  const body = await req.json();
  const { nombre, sku, precio, costo, stock, stock_minimo, marca, peso_gramos, fecha_vencimiento, dias_alerta, precio_oferta, en_oferta } = body;

  if (!nombre?.trim()) return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  if (!sku?.trim()) return NextResponse.json({ error: "SKU requerido" }, { status: 400 });
  if (!precio || Number(precio) <= 0) return NextResponse.json({ error: "Precio inválido" }, { status: 400 });
  if (fecha_vencimiento && dias_alerta && Number(dias_alerta) < 1)
    return NextResponse.json({ error: "dias_alerta debe ser >= 1 si fecha_vencimiento está establecida" }, { status: 400 });

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
      fecha_vencimiento: fecha_vencimiento || null,
      dias_alerta: dias_alerta ? Number(dias_alerta) : 30,
      precio_oferta: precio_oferta ? Number(precio_oferta) : null,
      en_oferta: en_oferta === true,
      activo: true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "El SKU ya existe" }, { status: 409 });
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  syncProductsToHub([{
    producto_id: data.id,
    nombre_producto: data.nombre,
    marca: data.marca ?? undefined,
    precio: Number(data.precio),
    stock: data.stock,
    activo: true,
  }]);

  return NextResponse.json(data, { status: 201 });
}
