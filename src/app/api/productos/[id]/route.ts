import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { syncProductsToHub } from "@/lib/hub-sync";
import { ProductoUpdateSchema } from "@/lib/validation";

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
  const parsed = ProductoUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.nombre !== undefined) updates.nombre = parsed.data.nombre.trim();
  if (parsed.data.sku !== undefined) updates.sku = parsed.data.sku.trim().toUpperCase();
  if (parsed.data.precio !== undefined) updates.precio = parsed.data.precio;
  if (parsed.data.costo !== undefined) updates.costo = parsed.data.costo;
  if (parsed.data.stock_minimo !== undefined) updates.stock_minimo = parsed.data.stock_minimo;
  if (parsed.data.marca !== undefined) updates.marca = parsed.data.marca?.trim() || null;
  if (parsed.data.peso_gramos !== undefined) updates.peso_gramos = parsed.data.peso_gramos;
  if (parsed.data.fecha_vencimiento !== undefined) updates.fecha_vencimiento = parsed.data.fecha_vencimiento || null;
  if (parsed.data.dias_alerta !== undefined) updates.dias_alerta = parsed.data.dias_alerta || 30;
  if (parsed.data.precio_oferta !== undefined) updates.precio_oferta = parsed.data.precio_oferta;
  if (parsed.data.en_oferta !== undefined) updates.en_oferta = parsed.data.en_oferta;
  if (parsed.data.categoria_id !== undefined) updates.categoria_id = parsed.data.categoria_id;

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

  syncProductsToHub([{
    producto_id: data.id,
    nombre_producto: data.nombre,
    marca: data.marca ?? undefined,
    precio: Number(data.precio),
    stock: data.stock,
    activo: data.activo ?? true,
  }]);

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
  const { data, error } = await supabase
    .from("productos")
    .update({ activo: false })
    .eq("id", id)
    .eq("store_id", store_id)
    .select("id, nombre, marca, precio, stock")
    .single();

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  if (data) {
    syncProductsToHub([{
      producto_id: data.id,
      nombre_producto: data.nombre,
      marca: data.marca ?? undefined,
      precio: Number(data.precio),
      stock: data.stock,
      activo: false,
    }]);
  }

  return new NextResponse(null, { status: 204 });
}
