import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { syncProductsToHub } from "@/lib/hub-sync";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { InventarioUpdateSchema } from "@/lib/validation";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const { id } = await params;
  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = InventarioUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { tipo, cantidad, notas } = parsed.data;

  const { data: prod } = await supabase
    .from("productos")
    .select("id, stock")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();

  if (!prod) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const { ipAddress, userAgent } = await getRequestMetadata(req);
  const auditOldValues = { stock: prod.stock };

  const delta = tipo === "entrada" ? cantidad : -cantidad;
  const nuevoStock = Math.max(0, prod.stock + delta);

  const { data: updated, error } = await supabase
    .from("productos")
    .update({ stock: nuevoStock })
    .eq("id", id)
    .select("id, nombre, marca, precio, stock, codigo_barra, tipo_animal, peso_gramos, en_oferta, precio_oferta, imagen_url, categorias(nombre)")
    .single();

  if (error) {
    await logAudit({
      storeId: store_id,
      userId: ctx.userId,
      action: "UPDATE",
      entityType: "inventario",
      entityId: id,
      oldValues: auditOldValues,
      newValues: { stock: nuevoStock },
      ipAddress,
      userAgent,
      result: "failure",
      errorMessage: error.message,
    });
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  await logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "inventario",
    entityId: id,
    oldValues: auditOldValues,
    newValues: updated,
    changeDescription: `Stock ajustado de ${prod.stock} a ${updated.stock} (${tipo}: ${Math.abs(delta)})`,
    ipAddress,
    userAgent,
    result: "success",
  });

  syncProductsToHub([{
    producto_id: updated.id,
    nombre_producto: updated.nombre,
    marca: updated.marca ?? undefined,
    codigo_barra: updated.codigo_barra ?? null,
    precio: Number(updated.precio),
    stock: updated.stock,
    tipo_animal: updated.tipo_animal ?? undefined,
    peso_gramos: updated.peso_gramos ?? undefined,
    precio_oferta: updated.precio_oferta ? Number(updated.precio_oferta) : undefined,
    en_oferta: updated.en_oferta ?? false,
    categoria: (updated.categorias as unknown as { nombre: string } | null)?.nombre ?? undefined,
    imagen_url: updated.imagen_url ?? null,
    activo: true,
  }]);

  await supabase.from("stock_movements").insert({
    producto_id: id,
    tipo,
    cantidad: delta,
    notas: notas ?? `Ajuste manual ${tipo}`,
    user_id: ctx.userId,
  });

  return NextResponse.json(updated);
}