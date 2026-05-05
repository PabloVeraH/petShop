import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { OrdenCompraReceiveSchema, OrdenCompraEstadoSchema } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: orden, error } = await supabase
    .from("ordenes_compra")
    .select("id, numero, estado, subtotal, impuesto, total, fecha_estimada, fecha_recibida, notas, created_at, proveedores(nombre, telefono, email)")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();
  if (error || !orden) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const { data: items } = await supabase
    .from("ordenes_compra_items")
    .select("id, cantidad_solicitada, cantidad_recibida, precio_unitario, subtotal, productos(id, nombre, sku)")
    .eq("orden_id", id);

  return NextResponse.json({ ...orden, items: items ?? [] });
}

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

    // Receiving order: estado = "recibida", items with cantidad_recibida
    if (body.action === "recibir") {
    const parsed = OrdenCompraReceiveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { items, lotes } = parsed.data;
    const lotesPorProducto = new Map(
      (lotes ?? []).map(l => [l.producto_id, l])
    );

    // Update each item
    for (const item of items) {
      await supabase.from("ordenes_compra_items")
        .update({ cantidad_recibida: item.cantidad_recibida })
        .eq("id", item.id);

      if (item.cantidad_recibida <= 0) continue;

      const loteData = lotesPorProducto.get(item.producto_id);

      if (loteData) {
        // Alimento con datos de vencimiento → crear lote
        // El trigger de lotes_producto actualiza productos.stock automáticamente
        const { data: lote, error: loteError } = await supabase
          .from("lotes_producto")
          .insert({
            store_id,
            producto_id: item.producto_id,
            numero_lote: loteData.numero_lote ?? null,
            cantidad_inicial: item.cantidad_recibida,
            cantidad_actual: item.cantidad_recibida,
            fecha_vencimiento: loteData.fecha_vencimiento,
            fecha_ingreso: new Date().toISOString().split("T")[0],
            orden_compra_id: id,
            notas: loteData.notas ?? `Recepción orden ${id}`,
          })
          .select()
          .single();

        if (loteError) {
          return NextResponse.json(
            { error: `Error al crear lote para producto ${item.producto_id}: ${loteError.message}` },
            { status: 500 }
          );
        }

        await logAudit({
          storeId: store_id,
          userId: ctx.userId,
          action: "CREATE",
          entityType: "lotes_producto",
          entityId: lote.id,
          newValues: lote,
        });

        await supabase.from("stock_movements").insert({
          producto_id: item.producto_id,
          tipo: "entrada",
          cantidad: item.cantidad_recibida,
          referencia_id: id,
          notas: `Recepción orden ${id} — lote ${lote.id}`,
        });
      } else {
        // Producto sin lotes (no es alimento o sin datos de vencimiento) → stock directo
        const { data: prod } = await supabase.from("productos").select("stock").eq("id", item.producto_id).single();
        if (prod) {
          await supabase.from("productos").update({ stock: prod.stock + item.cantidad_recibida }).eq("id", item.producto_id);
        }

        await supabase.from("stock_movements").insert({
          producto_id: item.producto_id,
          tipo: "entrada",
          cantidad: item.cantidad_recibida,
          referencia_id: id,
          notas: `Recepción orden ${id}`,
        });
      }
    }

    // Mark order as received (also verifies store ownership)
    const { data: orden, error } = await supabase
      .from("ordenes_compra")
      .update({ estado: "recibida", fecha_recibida: new Date().toISOString().split("T")[0] })
      .eq("id", id)
      .eq("store_id", store_id)
      .select().single();
    if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

    // Create cuenta por pagar if not exists
    const { data: existente } = await supabase
      .from("cuentas_pagar").select("id").eq("orden_id", id).single();
    if (!existente) {
      const vencimiento = new Date();
      vencimiento.setDate(vencimiento.getDate() + 30);
      await supabase.from("cuentas_pagar").insert({
        store_id,
        orden_id: id,
        proveedor_id: orden.proveedor_id,
        monto: orden.total,
        fecha_emision: new Date().toISOString().split("T")[0],
        fecha_vencimiento: vencimiento.toISOString().split("T")[0],
        estado: "pendiente",
      });
    }

    return NextResponse.json(orden);
  }

  // Simple estado update — only allow estado field, always scope to store
  const parsed = OrdenCompraEstadoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { estado } = parsed.data;

  const { data, error } = await supabase
    .from("ordenes_compra")
    .update({ estado })
    .eq("id", id)
    .eq("store_id", store_id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data);
}
