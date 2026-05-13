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

  if (parsed.data.stock !== undefined) {
    const { count } = await supabase
      .from("lotes_producto")
      .select("*", { count: "exact", head: true })
      .eq("producto_id", id)
      .eq("store_id", store_id)
      .eq("activo", true);

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Este producto usa sistema de lotes. Modificar stock a través de lotes." },
        { status: 422 }
      );
    }
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.nombre !== undefined) updates.nombre = parsed.data.nombre.trim();
  if (parsed.data.sku !== undefined) updates.sku = parsed.data.sku.trim().toUpperCase();
  if (parsed.data.precio !== undefined) updates.precio = parsed.data.precio;
  if (parsed.data.costo !== undefined) updates.costo = parsed.data.costo;
  if (parsed.data.stock_minimo !== undefined) updates.stock_minimo = parsed.data.stock_minimo;
  if (parsed.data.marca !== undefined) updates.marca = parsed.data.marca?.trim() || null;
  if (parsed.data.peso_gramos !== undefined) updates.peso_gramos = parsed.data.peso_gramos;
  if (parsed.data.fecha_vencimiento !== undefined) {
    updates.fecha_vencimiento = parsed.data.fecha_vencimiento || null;
    if (parsed.data.fecha_vencimiento) updates.tiene_vencimiento = true;
  }
  if (parsed.data.dias_alerta_expira !== undefined) updates.dias_alerta_expira = parsed.data.dias_alerta_expira || 30;
  if (parsed.data.precio_oferta !== undefined) updates.precio_oferta = parsed.data.precio_oferta;
  if (parsed.data.en_oferta !== undefined) updates.en_oferta = parsed.data.en_oferta;
  if (parsed.data.categoria_id !== undefined) updates.categoria_id = parsed.data.categoria_id;
  if (parsed.data.codigo_barra !== undefined) updates.codigo_barra = parsed.data.codigo_barra?.trim() || null;

  const { data, error } = await supabase
    .from("productos")
    .update(updates)
    .eq("id", id)
    .eq("store_id", store_id)
    .select("*, categorias(nombre)")
    .single();

  if (error) {
    if (error.code === "23505") {
      const msg = error.message?.includes("codigo_barra") ? "El código de barra ya existe" : "El SKU ya existe";
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  if (data) {
    if (data.fecha_vencimiento && data.stock > 0 && updates.tiene_vencimiento) {
      const { count } = await supabase
        .from("lotes_producto")
        .select("*", { count: "exact", head: true })
        .eq("producto_id", id)
        .eq("store_id", store_id)
        .eq("activo", true);

      if ((count ?? 0) === 0) {
        await supabase.from("lotes_producto").insert({
          store_id,
          producto_id: id,
          numero_lote: "LOTE-0",
          cantidad_inicial: data.stock,
          cantidad_actual: data.stock,
          fecha_vencimiento: data.fecha_vencimiento,
          fecha_ingreso: new Date().toISOString().split("T")[0],
          notas: "Lote inicial — stock existente al activar vencimientos",
        });
      }
    }

    syncProductsToHub([{
      producto_id: data.id,
      nombre_producto: data.nombre,
      marca: data.marca ?? undefined,
      codigo_barra: data.codigo_barra ?? null,
      precio: Number(data.precio),
      stock: data.stock,
      tipo_animal: data.tipo_animal ?? undefined,
      peso_gramos: data.peso_gramos ?? undefined,
      precio_oferta: data.precio_oferta ? Number(data.precio_oferta) : undefined,
      en_oferta: data.en_oferta ?? false,
      categoria: (data.categorias as unknown as { nombre: string } | null)?.nombre ?? undefined,
      imagen_url: data.imagen_url ?? null,
      activo: data.activo ?? true,
    }]);
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
  const { data, error } = await supabase
    .from("productos")
    .update({ activo: false })
    .eq("id", id)
    .eq("store_id", store_id)
    .select("id, nombre, marca, precio, stock, codigo_barra, tipo_animal, peso_gramos, en_oferta, precio_oferta, imagen_url, categorias(nombre)")
    .single();

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  if (data) {
    syncProductsToHub([{
      producto_id: data.id,
      nombre_producto: data.nombre,
      marca: data.marca ?? undefined,
      codigo_barra: data.codigo_barra ?? null,
      precio: Number(data.precio),
      stock: data.stock,
      tipo_animal: data.tipo_animal ?? undefined,
      peso_gramos: data.peso_gramos ?? undefined,
      precio_oferta: data.precio_oferta ? Number(data.precio_oferta) : undefined,
      en_oferta: data.en_oferta ?? false,
      categoria: (data.categorias as unknown as { nombre: string } | null)?.nombre ?? undefined,
      imagen_url: data.imagen_url ?? null,
      activo: false,
    }]);
  }

  return new NextResponse(null, { status: 204 });
}
