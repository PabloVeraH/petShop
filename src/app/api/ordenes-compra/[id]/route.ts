import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { OrdenCompraReceiveSchema, OrdenCompraEstadoSchema } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { crearAsiento, lineasCompra } from "@/lib/contabilidad/generador-asientos";
import { sendOrdenCompraEmail, sendOrdenCompraCancelacionEmail } from "@/lib/email";

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
    .select("id, cantidad_solicitada, cantidad_recibida, precio_unitario, subtotal, nombre_nuevo, productos(id, nombre, sku, tiene_vencimiento)")
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

  // Receiving order: estado = "recibida", items with cantidad_recibida and precio_unitario
  if (body.action === "recibir") {
    const parsed = OrdenCompraReceiveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { items } = parsed.data;

    // Verificar que la orden pertenece al store
    const { data: ordenBase, error: ordenBaseError } = await supabase
      .from("ordenes_compra")
      .select("id, proveedor_id, numero")
      .eq("id", id)
      .eq("store_id", store_id)
      .single();
    if (ordenBaseError || !ordenBase) {
      return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    }

    let totalNeto = 0;

    for (const item of items) {
      const subtotalItem = item.cantidad_recibida * item.precio_unitario;
      totalNeto += subtotalItem;

      // Actualizar el item con cantidades y precios reales
      await supabase
        .from("ordenes_compra_items")
        .update({
          cantidad_recibida: item.cantidad_recibida,
          precio_unitario: item.precio_unitario,
          subtotal: subtotalItem,
        })
        .eq("id", item.id);

      if (item.cantidad_recibida <= 0) continue;

      // Resolver producto_id: existente o crear nuevo
      let productoId = item.producto_id ?? null;

      if (!productoId && item.nombre_nuevo) {
        const skuAuto = "PROD-" + crypto.randomUUID().slice(0, 8).toUpperCase();
        const tieneVenc = !!item.fecha_vencimiento;
        const { data: nuevoProd, error: prodError } = await supabase
          .from("productos")
          .insert({
            store_id,
            nombre: item.nombre_nuevo,
            sku: skuAuto,
            precio: null,
            costo: item.precio_unitario,
            stock: 0,
            stock_minimo: 0,
            activo: true,
            tiene_vencimiento: tieneVenc,
          })
          .select("id")
          .single();

        if (prodError || !nuevoProd) {
          return NextResponse.json(
            { error: `Error al crear producto '${item.nombre_nuevo}': ${prodError?.message}` },
            { status: 500 }
          );
        }
        productoId = nuevoProd.id;

        // Actualizar el item con el producto_id recién creado
        await supabase
          .from("ordenes_compra_items")
          .update({ producto_id: productoId })
          .eq("id", item.id);
      }

      if (!productoId) continue;

      if (item.fecha_vencimiento) {
        // Auto-generate numero_lote if not provided: LOTE-{count of existing lotes}
        let numeroLote = item.numero_lote ?? null;
        if (!numeroLote) {
          const { count } = await supabase
            .from("lotes_producto")
            .select("*", { count: "exact", head: true })
            .eq("producto_id", productoId)
            .eq("store_id", store_id);
          numeroLote = `LOTE-${count ?? 0}`;
        }

        // Crear lote — el trigger sync_stock_on_lote actualiza productos.stock
        const { data: lote, error: loteError } = await supabase
          .from("lotes_producto")
          .insert({
            store_id,
            producto_id: productoId,
            numero_lote: numeroLote,
            cantidad_inicial: item.cantidad_recibida,
            cantidad_actual: item.cantidad_recibida,
            fecha_vencimiento: item.fecha_vencimiento,
            fecha_ingreso: new Date().toISOString().split("T")[0],
            orden_compra_id: id,
            notas: `Recepción OC ${ordenBase.numero}`,
          })
          .select()
          .single();

        if (loteError) {
          return NextResponse.json(
            { error: `Error al crear lote: ${loteError.message}` },
            { status: 500 }
          );
        }

        // Marcar producto con tiene_vencimiento = true
        await supabase
          .from("productos")
          .update({ tiene_vencimiento: true })
          .eq("id", productoId)
          .eq("tiene_vencimiento", false);

        await logAudit({
          storeId: store_id,
          userId: ctx.userId,
          action: "CREATE",
          entityType: "lotes_producto",
          entityId: lote.id,
          newValues: lote,
        });

        await supabase.from("stock_movements").insert({
          producto_id: productoId,
          tipo: "entrada",
          cantidad: item.cantidad_recibida,
          referencia_id: id,
          notas: `Recepción OC ${ordenBase.numero} — lote ${lote.id}`,
        });
      } else {
        // Sin fecha de vencimiento → stock directo
        const { data: prod } = await supabase
          .from("productos")
          .select("stock")
          .eq("id", productoId)
          .single();
        if (prod) {
          await supabase
            .from("productos")
            .update({ stock: prod.stock + item.cantidad_recibida })
            .eq("id", productoId);
        }

        await supabase.from("stock_movements").insert({
          producto_id: productoId,
          tipo: "entrada",
          cantidad: item.cantidad_recibida,
          referencia_id: id,
          notas: `Recepción OC ${ordenBase.numero}`,
        });
      }
    }

    // Calcular totales reales y actualizar la OC
    const impuesto = Math.round(totalNeto * 0.19);
    const total = totalNeto + impuesto;

    const { data: orden, error: ordenError } = await supabase
      .from("ordenes_compra")
      .update({
        estado: "recibida",
        fecha_recibida: new Date().toISOString().split("T")[0],
        subtotal: totalNeto,
        impuesto,
        total,
      })
      .eq("id", id)
      .eq("store_id", store_id)
      .select()
      .single();

    if (ordenError) {
      return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }

    // Crear cuenta por pagar
    const { data: existente } = await supabase
      .from("cuentas_pagar")
      .select("id")
      .eq("orden_id", id)
      .single();

    if (!existente) {
      const vencimiento = new Date();
      vencimiento.setDate(vencimiento.getDate() + 30);
      await supabase.from("cuentas_pagar").insert({
        store_id,
        orden_id: id,
        proveedor_id: ordenBase.proveedor_id,
        monto: total,
        fecha_emision: new Date().toISOString().split("T")[0],
        fecha_vencimiento: vencimiento.toISOString().split("T")[0],
        estado: "pendiente",
      });
    }

    // Asiento contable (fire-and-forget)
    crearAsiento({
      storeId: store_id,
      fecha: new Date().toISOString().split("T")[0],
      tipoMovimiento: "COMPRA",
      referenciaId: id,
      referenciaNomero: ordenBase.numero,
      descripcion: `Recepción compra — ${ordenBase.numero}`,
      lineas: lineasCompra({ montoNeto: totalNeto, iva: impuesto, total }),
      usuarioId: ctx.userId ?? undefined,
    }).catch(e => console.error("[contabilidad] Error asiento compra:", e));

    return NextResponse.json(orden);
  }

  // Simple estado update — only allow estado field, always scope to store
  const parsed = OrdenCompraEstadoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { estado, notificar_proveedor } = parsed.data;

  const { data, error } = await supabase
    .from("ordenes_compra")
    .update({ estado })
    .eq("id", id)
    .eq("store_id", store_id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  // Si el estado es "cancelada" y se solicitó notificar, enviar email de cancelación
  if (estado === "cancelada" && notificar_proveedor) {
    const [proveedorRes, storeRes] = await Promise.all([
      supabase.from("proveedores").select("nombre, email").eq("id", data.proveedor_id).single(),
      supabase.from("stores").select("name, address, resend_from_email").eq("id", store_id).single(),
    ]);

    const proveedor = proveedorRes.data;
    const store = storeRes.data;

    if (proveedor?.email && store) {
      sendOrdenCompraCancelacionEmail({
        to: proveedor.email,
        proveedorNombre: proveedor.nombre,
        storeName: store.name,
        storeAddress: store.address ?? undefined,
        storeFromEmail: store.resend_from_email ?? undefined,
        orden: {
          numero: data.numero,
          fecha: new Date().toLocaleDateString("es-CL"),
        },
      }).catch(e => console.error("[email-oc] Error enviando cancelación:", e));
    }
  }

  // Si el estado es "enviada", enviar email al proveedor
  if (estado === "enviada") {
    const [proveedorRes, storeRes, itemsRes] = await Promise.all([
      supabase
        .from("proveedores")
        .select("nombre, email")
        .eq("id", data.proveedor_id)
        .single(),
      supabase
        .from("stores")
        .select("name, address, resend_from_email")
        .eq("id", store_id)
        .single(),
      supabase
        .from("ordenes_compra_items")
        .select("cantidad_solicitada, producto_id, nombre_nuevo, productos(nombre)")
        .eq("orden_id", id),
    ]);

    const proveedor = proveedorRes.data;
    const store = storeRes.data;
    const itemsData = itemsRes.data ?? [];

    if (proveedor?.email && store) {
      sendOrdenCompraEmail({
        to: proveedor.email,
        proveedorNombre: proveedor.nombre,
        storeName: store.name,
        storeAddress: store.address ?? undefined,
        storeFromEmail: store.resend_from_email ?? undefined,
        orden: {
          numero: data.numero,
          fecha: new Date().toLocaleDateString("es-CL"),
          notas: data.notas ?? undefined,
        },
        items: itemsData.map(i => ({
          nombre: ((i.productos as unknown as { nombre: string } | null)?.nombre) ?? i.nombre_nuevo ?? "Producto",
          cantidad: i.cantidad_solicitada,
        })),
      }).catch(e => console.error("[email-oc] Error enviando OC:", e));
    }
  }

  return NextResponse.json(data);
}
