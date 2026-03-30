import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { id } = await params;

  const body = await req.json();
  const { nombre, sku, precio, costo, stock_minimo, marca, peso_gramos } = body;

  if (nombre !== undefined && !nombre?.trim())
    return NextResponse.json({ error: "Nombre no puede estar vacío" }, { status: 400 });
  if (precio !== undefined && Number(precio) <= 0)
    return NextResponse.json({ error: "Precio inválido" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (nombre !== undefined) updates.nombre = nombre.trim();
  if (sku !== undefined) updates.sku = sku.trim().toUpperCase();
  if (precio !== undefined) updates.precio = Number(precio);
  if (costo !== undefined) updates.costo = costo ? Number(costo) : null;
  if (stock_minimo !== undefined) updates.stock_minimo = Number(stock_minimo);
  if (marca !== undefined) updates.marca = marca?.trim() || null;
  if (peso_gramos !== undefined) updates.peso_gramos = peso_gramos ? Number(peso_gramos) : null;

  const { data, error } = await supabase
    .from("productos")
    .update(updates)
    .eq("id", id)
    .eq("store_id", store_id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "El SKU ya existe" }, { status: 409 });
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { id } = await params;

  // Soft delete — keeps history intact
  const { error } = await supabase
    .from("productos")
    .update({ activo: false })
    .eq("id", id)
    .eq("store_id", store_id);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
