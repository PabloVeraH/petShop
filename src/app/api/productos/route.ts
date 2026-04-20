import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { syncProductsToHub } from "@/lib/hub-sync";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { ProductoCreateSchema } from "@/lib/validation";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const searchSchema = z.string().max(100); // Limit search length
  const searchResult = searchSchema.safeParse(req.nextUrl.searchParams.get("search"));
  const search = searchResult.success ? searchResult.data : "";

  let query = supabase
    .from("productos")
    .select("id, store_id, nombre, sku, precio, stock, stock_minimo, fecha_vencimiento, dias_alerta, precio_oferta, en_oferta, codigo_barra")
    .eq("store_id", store_id)
    .eq("activo", true)
    .gt("stock", 0);

  if (search.trim()) {
    // Sanitize to prevent PostgREST filter string manipulation
    const s = search.replace(/[()%,]/g, "");
    query = query.or(`nombre.ilike.%${s}%,sku.ilike.%${s}%,codigo_barra.eq.${s}`);
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
  const parsed = ProductoCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { nombre, sku, precio, costo, stock, stock_minimo, marca, peso_gramos, fecha_vencimiento, dias_alerta, precio_oferta, en_oferta, categoria_id, codigo_barra } = parsed.data;

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
      categoria_id: categoria_id ?? null,
      codigo_barra: codigo_barra?.trim() || null,
      activo: true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      const msg = error.message?.includes("codigo_barra") ? "El código de barra ya existe" : "El SKU ya existe";
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { ipAddress, userAgent } = await getRequestMetadata(req);

  await logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "CREATE",
    entityType: "producto",
    entityId: data.id,
    newValues: data,
    changeDescription: `Producto creado: ${nombre} (SKU: ${sku})`,
    ipAddress,
    userAgent,
    result: "success",
  });

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
