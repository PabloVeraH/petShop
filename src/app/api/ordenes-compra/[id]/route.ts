import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { OrdenCompraReceiveSchema, OrdenCompraEditItemsSchema, OrdenCompraEstadoSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { crearAsiento, lineasCompra } from "@/lib/contabilidad/generador-asientos";
import { sendOrdenCompraEmail, sendOrdenCompraCancelacionEmail } from "@/lib/email";
import { mapearErrorStock } from "@/lib/stock-errors";
import type { RegistrarLoteResultado } from "@/types";

export const GET = withErrorLogging(async (_req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
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
}, { endpoint: "GET /api/ordenes-compra/id" });

export const PATCH = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
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

    // ── Prevalidación de stock/lotes (Fase 1, D11) — ANTES de escribir nada ──
    // La recepción recorre los items con escrituras independientes (no es una
    // transacción): cualquier rechazo debe ocurrir aquí, no a mitad del loop.
    //  - IDOR: un producto_id que no es de esta tienda se rechaza (antes se
    //    le hacía increment_stock sin verificar el tenant).
    //  - Producto CON lotes sin fecha de vencimiento: increment_stock sumaría
    //    a productos.stock y el trigger lo borraría en el próximo cambio de
    //    lote → se exige la fecha.
    //  - Producto SIN lotes con stock suelto y fecha de vencimiento: el stock
    //    suelto se convierte en LOTE-0 (registrar_lote) y necesita su propio
    //    vencimiento (D21): el del producto o el enviado en el item.
    const idsExistentes = [...new Set(
      items.filter((i) => i.cantidad_recibida > 0 && i.producto_id).map((i) => i.producto_id as string)
    )];
    const productosInfo = new Map<string, { nombre: string; stock: number; fecha_vencimiento: string | null; tieneLotes: boolean }>();
    if (idsExistentes.length > 0) {
      const [{ data: prods }, { data: lotesActivos }] = await Promise.all([
        supabase
          .from("productos")
          .select("id, nombre, stock, fecha_vencimiento")
          .in("id", idsExistentes)
          .eq("store_id", store_id),
        supabase
          .from("lotes_producto")
          .select("producto_id")
          .in("producto_id", idsExistentes)
          .eq("store_id", store_id)
          .eq("activo", true),
      ]);
      const conLotes = new Set((lotesActivos ?? []).map((l) => l.producto_id as string));
      for (const p of prods ?? []) {
        productosInfo.set(p.id, {
          nombre: p.nombre,
          stock: Number(p.stock ?? 0),
          fecha_vencimiento: p.fecha_vencimiento ?? null,
          tieneLotes: conLotes.has(p.id),
        });
      }
    }
    const conFechaEnEstaOc = new Set(
      items.filter((i) => i.cantidad_recibida > 0 && i.producto_id && i.fecha_vencimiento).map((i) => i.producto_id as string)
    );
    for (const item of items) {
      if (item.cantidad_recibida <= 0 || !item.producto_id) continue;
      const info = productosInfo.get(item.producto_id);
      if (!info) {
        return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
      }
      // Otra línea de esta misma OC le crea lotes al producto → esta también
      // necesita fecha (si no, fallaría a mitad de la recepción).
      if (!item.fecha_vencimiento && (info.tieneLotes || conFechaEnEstaOc.has(item.producto_id))) {
        return NextResponse.json(
          { error: `"${info.nombre}" usa lotes: indica la fecha de vencimiento de lo recibido` },
          { status: 422 }
        );
      }
      if (item.fecha_vencimiento && !info.tieneLotes && info.stock > 0 &&
          !info.fecha_vencimiento && !item.fecha_vencimiento_stock_existente) {
        return NextResponse.json(
          { error: `"${info.nombre}" tiene ${info.stock} unidades sin lote: indica su fecha de vencimiento (se registrarán como lote inicial)` },
          { status: 422 }
        );
      }
    }

    let totalNeto = 0;
    // MEJORA (ticket Trello 6a62eb37bfe280fc94919d5e): el log de auditoría de
    // "lotes_producto" quedaba con changeDescription/ipAddress vacíos —
    // calculado una vez para toda la request, igual que en el flujo
    // "edit_items" de este mismo archivo (línea ~330).
    const { ipAddress, userAgent } = getRequestMetadata(req);

    for (const item of items) {
      // Math.round: precio_unitario acepta decimales (Zod solo exige
      // nonnegative), y cantidad_recibida * precio_unitario puede no ser un
      // peso entero. Sin este redondeo por ítem, totalNeto (y por lo tanto
      // subtotal/total de la OC) queda con decimales residuales — bug real
      // confirmado en producción (OC-20260329-E299AC, ticket Trello
      // 6a5f9af49b22d1d60a11747d): "$1.503.077,1" en vez de "$1.503.077".
      // El impuesto ya se redondeaba (043e378) pero totalNeto no, por lo que
      // el decimal sobrevivía en total = totalNeto + impuesto.
      const subtotalItem = Math.round(item.cantidad_recibida * item.precio_unitario);
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
      // nombre_nuevo cubre el caso "producto creado en esta recepción"; para
      // un producto ya existente el payload no trae su nombre (ver
      // OrdenCompraReceiveItemSchema), se resuelve más abajo con un SELECT.
      let nombreProducto: string | null = item.nombre_nuevo ?? null;

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
        // Solo se necesita el nombre para el changeDescription del lote que
        // se crea en esta rama — evita el SELECT extra en la rama sin lote.
        if (!nombreProducto) {
          const { data: prodExistente } = await supabase
            .from("productos")
            .select("nombre")
            .eq("id", productoId)
            .single();
          nombreProducto = prodExistente?.nombre ?? null;
        }

        // Auto-generate numero_lote if not provided: LOTE-{count of existing lotes}
        // (+1 si en esta misma recepción el stock suelto pasa a ser "LOTE-0").
        const info = productosInfo.get(productoId);
        const convertiraStockSuelto = !!info && !info.tieneLotes && info.stock > 0;
        let numeroLote = item.numero_lote ?? null;
        if (!numeroLote) {
          const { count } = await supabase
            .from("lotes_producto")
            .select("*", { count: "exact", head: true })
            .eq("producto_id", productoId)
            .eq("store_id", store_id);
          numeroLote = `LOTE-${(count ?? 0) + (convertiraStockSuelto ? 1 : 0)}`;
        }

        // D11 (S6): registrar_lote convierte el stock suelto en LOTE-0 y crea
        // el lote nuevo en una transacción (antes el INSERT directo hacía que
        // el trigger recalculara stock = Σ lotes y se perdiera el suelto).
        // También marca tiene_vencimiento y registra el stock_movements.
        const { data: registro, error: loteError } = await supabase.rpc("registrar_lote", {
          p_store_id:                   store_id,
          p_producto_id:                productoId,
          p_cantidad_inicial:           item.cantidad_recibida,
          p_fecha_vencimiento:          item.fecha_vencimiento,
          p_user_id:                    ctx.userId,
          p_numero_lote:                numeroLote,
          p_orden_compra_id:            id,
          p_notas:                      `Recepción OC ${ordenBase.numero}`,
          p_fecha_venc_stock_existente: item.fecha_vencimiento_stock_existente ?? null,
          p_movimiento_notas:           `Recepción OC ${ordenBase.numero}`,
        });

        if (loteError) {
          const mapped = mapearErrorStock(loteError.message);
          return NextResponse.json(
            { error: mapped.status === 500 ? "Error al crear lote" : mapped.error },
            { status: mapped.status }
          );
        }

        const { lote, lote_inicial } = registro as RegistrarLoteResultado;

        if (lote_inicial) {
          await logAudit({
            storeId: store_id,
            userId: ctx.userId,
            action: "CREATE",
            entityType: "lotes_producto",
            entityId: lote_inicial.id,
            newValues: { ...lote_inicial },
            changeDescription: `Stock existente convertido a lote inicial: ${nombreProducto ?? "Producto"} × ${lote_inicial.cantidad_inicial} unidades — ${ordenBase.numero}`,
            ipAddress,
            userAgent,
          });
        }

        await logAudit({
          storeId: store_id,
          userId: ctx.userId,
          action: "CREATE",
          entityType: "lotes_producto",
          entityId: lote.id,
          newValues: { ...lote },
          changeDescription: `Recepción de lote: ${nombreProducto ?? "Producto"} × ${item.cantidad_recibida} unidades — ${ordenBase.numero}`,
          ipAddress,
          userAgent,
        });
      } else {
        // Sin fecha de vencimiento → stock directo. Incremento atómico vía RPC
        // (no SELECT stock + UPDATE stock=leído+cantidad en dos statements
        // separados): ese patrón es un lost update real bajo dos recepciones
        // concurrentes del mismo producto (dos OC casi simultáneas, o un
        // doble clic en "Confirmar recepción") — encontrado al investigar el
        // ticket Trello 6a61a6136d3d8009490d7113.
        // Desde la migración 074 increment_stock rechaza productos con lotes
        // (la prevalidación de arriba ya lo evita) — su error ya no se ignora.
        const { error: incError } = await supabase.rpc("increment_stock", {
          p_producto_id: productoId,
          p_cantidad: item.cantidad_recibida,
        });
        if (incError) {
          const mapped = mapearErrorStock(incError.message);
          return NextResponse.json({ error: mapped.error }, { status: mapped.status });
        }

        await supabase.from("stock_movements").insert({
          producto_id: productoId,
          tipo: "entrada",
          cantidad: item.cantidad_recibida,
          referencia_id: id,
          notas: `Recepción OC ${ordenBase.numero}`,
          user_id: ctx.userId,
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

    // Crear cuenta por pagar (solo si el monto es mayor a 0)
    if (total > 0) {
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
    }

    // Asiento contable (post-response fire-and-forget)
    (async () => {
      const asiento = await crearAsiento({
        storeId: store_id,
        fecha: new Date().toISOString().split("T")[0],
        tipoMovimiento: "COMPRA",
        referenciaId: id,
        referenciaNomero: ordenBase.numero,
        descripcion: `Recepción compra — ${ordenBase.numero}`,
        lineas: lineasCompra({ montoNeto: totalNeto, iva: impuesto, total }),
        usuarioId: ctx.userId ?? undefined,
      });
      if (!asiento) console.error(`[contabilidad] Asiento COMPRA NO CREADO para OC ${ordenBase.numero}`);
    })().catch((e) => console.error("[contabilidad] Error en asiento compra:", e));

    return NextResponse.json(orden);
  }

  // Edit items in a pending order — replaces all items
  if (body.action === "edit_items") {
    const parsed = OrdenCompraEditItemsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { items } = parsed.data;

    // Verify the order exists, is pending, and belongs to this store
    const { data: ordenBase, error: ordenBaseError } = await supabase
      .from("ordenes_compra")
      .select("id, estado, numero")
      .eq("id", id)
      .eq("store_id", store_id)
      .single();

    if (ordenBaseError || !ordenBase) {
      return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    }

    if (ordenBase.estado !== "pendiente") {
      return NextResponse.json({ error: "Solo se pueden editar órdenes pendientes" }, { status: 400 });
    }

    // Delete existing items and insert new ones in a transaction-like sequence
    const { error: deleteError } = await supabase
      .from("ordenes_compra_items")
      .delete()
      .eq("orden_id", id);

    if (deleteError) {
      return NextResponse.json({ error: "Error al reemplazar items" }, { status: 500 });
    }

    const { error: insertError } = await supabase.from("ordenes_compra_items").insert(
      items.map(i => ({
        orden_id: id,
        producto_id: i.producto_id ?? null,
        nombre_nuevo: i.nombre_nuevo ?? null,
        cantidad_solicitada: i.cantidad_solicitada,
        precio_unitario: null,
        subtotal: null,
      }))
    );

    if (insertError) {
      return NextResponse.json({ error: "Error al insertar items" }, { status: 500 });
    }

    const { ipAddress, userAgent } = getRequestMetadata(req);
    logAudit({
      storeId: store_id,
      userId: ctx.userId,
      action: "UPDATE",
      entityType: "orden_compra",
      entityId: id,
      changeDescription: `Items de OC ${ordenBase.numero} editados (reemplazados ${items.length} items)`,
      ipAddress,
      userAgent,
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  }

  // Simple estado update — "recibida" solo se permite vía action:"recibir" arriba
  if (body.estado === "recibida") {
    return NextResponse.json(
      { error: "Para recibir una orden de compra debe usar el flujo 'recibir' con items y precios" },
      { status: 400 }
    );
  }
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
}, { endpoint: "PATCH /api/ordenes-compra/id" });
