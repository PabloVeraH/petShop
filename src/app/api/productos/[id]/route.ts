import { getStoreId } from "@/lib/auth";
import { auth } from "@clerk/nextjs/server";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { syncProductsToHub } from "@/lib/hub-sync";
import { ProductoUpdateSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { eliminarImagenProducto } from "@/lib/r2-storage";

export const PATCH = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  // S11: editar un producto (precio, stock, vencimientos) es solo para
  // storeAdmin/systemAdmin — la UI ya muestra "Editar" solo a admin, pero eso
  // es UX; el control real es este.
  const { sessionClaims } = await auth();
  try {
    requireStoreAdmin(getAdminStatus(sessionClaims), store_id);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();

  const { id } = await params;

  const { data: productoActual } = await supabase
    .from("productos")
    .select("*")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();

  const body = await req.json();
  const parsed = ProductoUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Only block stock edits when the value actually changes — if the form sends the same
  // stock value it read, there's no real change and no need to guard against lot products.
  const stockCambia = parsed.data.stock !== undefined &&
    Number(parsed.data.stock) !== Number(productoActual?.stock);

  if (stockCambia) {
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
  if (parsed.data.precio_venta_kg !== undefined) updates.precio_venta_kg = parsed.data.precio_venta_kg;
  if (parsed.data.imagen_url !== undefined) updates.imagen_url = parsed.data.imagen_url ?? null;
  if (parsed.data.imagen_url_2 !== undefined) updates.imagen_url_2 = parsed.data.imagen_url_2 ?? null;

  const { data, error } = await supabase
    .from("productos")
    .update(updates)
    .eq("id", id)
    .eq("store_id", store_id)
    .select("*, categorias(nombre)")
    .single();

  if (error) {
    const { ipAddress, userAgent } = getRequestMetadata(req);
    logAudit({
      storeId: store_id,
      userId: ctx.userId,
      action: "UPDATE",
      entityType: "producto",
      entityId: id,
      changeDescription: "Error actualizando producto",
      ipAddress,
      userAgent,
      result: "failure",
      errorMessage: error.message,
    }).catch(() => {});
    if (error.code === "23505") {
      const msg = error.message?.includes("codigo_barra") ? "El código de barra ya existe" : "El SKU ya existe";
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    // Granel (migración 077): el peso del saco no cambia con un saco abierto
    // (trigger) y un precio por kg exige peso del saco (CHECK G8).
    if (error.message?.startsWith("No se puede cambiar el peso del saco")) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error.code === "23514" && error.message?.includes("productos_granel_requiere_peso")) {
      return NextResponse.json(
        { error: "Para vender a granel el producto necesita el peso del saco (peso en gramos)" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "producto",
    entityId: id,
    oldValues: productoActual ?? undefined,
    newValues: updates,
    changeDescription: `Producto actualizado: ${Object.keys(updates).join(", ")}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  // Limpiar imágenes huérfanas en R2 cuando se reemplazan o borran (fire-and-forget)
  if (data) {
    const imagenesParaLimpiar: Array<{ url: string; storeId: string }> = [];
    if (updates.imagen_url !== undefined && productoActual?.imagen_url && productoActual.imagen_url !== data.imagen_url) {
      imagenesParaLimpiar.push({ url: productoActual.imagen_url, storeId: store_id });
    }
    if (updates.imagen_url_2 !== undefined && productoActual?.imagen_url_2 && productoActual.imagen_url_2 !== data.imagen_url_2) {
      imagenesParaLimpiar.push({ url: productoActual.imagen_url_2, storeId: store_id });
    }
    for (const img of imagenesParaLimpiar) {
      eliminarImagenProducto(img.url, img.storeId).catch(() => {});
    }
  }

  if (data) {
    if (data.fecha_vencimiento && data.stock > 0 && updates.tiene_vencimiento) {
      // D11: al activar vencimientos, el stock suelto pasa a "LOTE-0". La RPC
      // bloquea el producto y es no-op si ya tiene lotes activos (antes: un
      // count + insert separados que dos requests concurrentes podían
      // duplicar). fecha_ingreso = alta del producto, para que FIFO lo
      // consuma primero.
      const { data: loteInicial, error: loteError } = await supabase.rpc("convertir_stock_suelto_a_lote", {
        p_store_id:          store_id,
        p_producto_id:       id,
        p_fecha_vencimiento: data.fecha_vencimiento,
      });
      const { ipAddress, userAgent } = getRequestMetadata(req);
      if (loteError) {
        console.error("[productos PATCH] Error convirtiendo stock a LOTE-0:", loteError.message);
        logAudit({
          storeId: store_id,
          userId: ctx.userId,
          action: "CREATE",
          entityType: "lote_producto",
          entityId: id,
          changeDescription: "Error convirtiendo stock existente a lote inicial",
          ipAddress,
          userAgent,
          result: "failure",
          errorMessage: loteError.message,
        }).catch(() => {});
      } else if (loteInicial) {
        logAudit({
          storeId: store_id,
          userId: ctx.userId,
          action: "CREATE",
          entityType: "lote_producto",
          entityId: (loteInicial as { id: string }).id,
          newValues: loteInicial as Record<string, unknown>,
          changeDescription: `Stock existente convertido a lote inicial: ${data.nombre} × ${data.stock} unidades`,
          ipAddress,
          userAgent,
        }).catch(() => {});
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
}, { endpoint: "PATCH /api/productos/id" });

export const DELETE = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
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
    .select("id, nombre, marca, precio, stock, codigo_barra, tipo_animal, peso_gramos, en_oferta, precio_oferta, imagen_url, imagen_url_2, categorias(nombre)")
    .single();

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "DELETE",
    entityType: "producto",
    entityId: id,
    oldValues: data ?? undefined,
    changeDescription: `Producto "${data?.nombre ?? id}" eliminado (soft delete)`,
    ipAddress,
    userAgent,
  }).catch(() => {});

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
}, { endpoint: "DELETE /api/productos/id" });
