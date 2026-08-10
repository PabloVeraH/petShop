import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { syncProductsToHub } from "@/lib/hub-sync";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { InventarioUpdateSchema } from "@/lib/validation";

export const PATCH = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id, userId } = ctx;

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

  // productos.stock se mantiene automáticamente vía trigger (sync_stock_on_lote,
  // migración 026) cuando el producto tiene lotes activos — se recalcula como
  // SUM(cantidad_actual) de lotes_producto. Escribir productos.stock directo
  // (como hacía este endpoint antes) rompe esa invariante: el trigger solo
  // reacciona a cambios en lotes_producto, así que un ajuste manual queda
  // huérfano respecto a la suma de lotes (ticket Trello 6a77e8454f3227d6d4a42437).
  // "Tiene lotes" usa el mismo criterio que productoTieneLotes() en
  // lote-helpers.ts (activo=true, sin importar cantidad_actual restante).
  const { count: lotesActivos } = await supabase
    .from("lotes_producto")
    .select("id", { count: "exact", head: true })
    .eq("producto_id", id)
    .eq("store_id", store_id)
    .eq("activo", true);
  const tieneLotes = (lotesActivos ?? 0) > 0;

  // Entrada en producto con lotes: no hay forma segura de generar un lote
  // automáticamente — lotes_producto.fecha_vencimiento es NOT NULL en el
  // schema real (no existe "lote sin vencimiento") y este modal rápido no
  // pide esa fecha. Inventar una fecha contaminaría alertas de vencimiento y
  // el orden FIFO. Se bloquea y se dirige al panel "Lotes" (POST /api/lotes),
  // que ya pide fecha_vencimiento explícitamente.
  if (tipo === "entrada" && tieneLotes) {
    return NextResponse.json(
      { error: "Este producto tiene lotes activos. Usa el panel \"Lotes\" para agregar stock con su fecha de vencimiento." },
      { status: 409 }
    );
  }

  if (tipo === "salida" && !tieneLotes && cantidad > prod.stock) {
    return NextResponse.json(
      { error: `Stock insuficiente: disponible ${prod.stock}, solicitado ${cantidad}` },
      { status: 422 }
    );
  }

  const { ipAddress, userAgent } = await getRequestMetadata(req);
  const auditOldValues = { stock: prod.stock };
  const delta = tipo === "entrada" ? cantidad : -cantidad;

  type ProductoActualizado = {
    id: string; nombre: string; marca: string | null; precio: number; stock: number;
    codigo_barra: string | null; tipo_animal: string | null; peso_gramos: number | null;
    en_oferta: boolean; precio_oferta: number | null; imagen_url: string | null;
    categorias: { nombre: string } | null;
  };

  // Pasos finales comunes a ambas ramas (con/sin lotes): auditoría, sync al
  // hub y registro del movimiento. Extraído para que TS no pierda el
  // narrowing de `updated` a través de las dos ramas condicionales de arriba.
  async function finalizarAjuste(updated: ProductoActualizado): Promise<NextResponse> {
    await logAudit({
      storeId: store_id,
      userId,
      action: "UPDATE",
      entityType: "inventario",
      entityId: id,
      oldValues: auditOldValues,
      newValues: updated,
      changeDescription: `Stock ajustado de ${prod!.stock} a ${updated.stock} (${tipo}: ${Math.abs(delta)})`,
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
      user_id: userId,
    });

    return NextResponse.json(updated);
  }

  if (tipo === "salida" && tieneLotes) {
    // Salida con lotes activos: descuenta FIFO (lote más antiguo primero) vía
    // la misma función que usan las ventas — mantiene lotes_producto y
    // productos.stock sincronizados por el trigger, en vez de escribir stock
    // directo. Lanza excepción si el stock vigente (no vencido) es
    // insuficiente — esa es la fuente de verdad real, no productos.stock (que
    // puede incluir lotes vencidos con cantidad_actual > 0).
    const { error: fifoError } = await supabase.rpc("deducir_stock_fifo", {
      p_producto_id: id,
      p_store_id: store_id,
      p_cantidad: cantidad,
    });

    if (fifoError) {
      if (fifoError.message?.includes("Stock insuficiente")) {
        return NextResponse.json({ error: fifoError.message }, { status: 422 });
      }
      await logAudit({
        storeId: store_id,
        userId,
        action: "UPDATE",
        entityType: "inventario",
        entityId: id,
        oldValues: auditOldValues,
        ipAddress,
        userAgent,
        result: "failure",
        errorMessage: fifoError.message,
      });
      return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }

    const { data: prodTrasLotes, error: refetchError } = await supabase
      .from("productos")
      .select("id, nombre, marca, precio, stock, codigo_barra, tipo_animal, peso_gramos, en_oferta, precio_oferta, imagen_url, categorias(nombre)")
      .eq("id", id)
      .single();

    if (refetchError || !prodTrasLotes) {
      return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
    return finalizarAjuste(prodTrasLotes as unknown as ProductoActualizado);
  }

  // Sin lotes activos: comportamiento original — stock del producto es la
  // única fuente de verdad, no hay invariante con lotes que mantener.
  const nuevoStock = Math.max(0, prod.stock + delta);

  const { data: prodActualizado, error } = await supabase
    .from("productos")
    .update({ stock: nuevoStock })
    .eq("id", id)
    .select("id, nombre, marca, precio, stock, codigo_barra, tipo_animal, peso_gramos, en_oferta, precio_oferta, imagen_url, categorias(nombre)")
    .single();

  if (error) {
    await logAudit({
      storeId: store_id,
      userId,
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

  return finalizarAjuste(prodActualizado as unknown as ProductoActualizado);
}, { endpoint: "PATCH /api/inventario/id" });