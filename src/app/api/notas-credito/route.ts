import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { NotaCreditoPostSchema } from "@/lib/validation";
import { crearAsiento, lineasNotaCredito, lineasNotaCreditoCOGS } from "@/lib/contabilidad/generador-asientos";
import { logAudit, getRequestMetadata } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id, systemAdmin } = ctx;
  const supabase = createServiceClient();

  // Lookup/validate a single NC by its code (used by POS for NC payment)
  const numeroNc = req.nextUrl.searchParams.get("numero_nc");
  if (numeroNc) {
    let ncQuery = supabase
      .from("notas_credito")
      .select("id, numero_nc, monto_total, fecha_vencimiento, estado")
      .eq("numero_nc", numeroNc);

    if (!systemAdmin) ncQuery = ncQuery.eq("store_id", store_id);

    const { data: nc } = await ncQuery.single();

    if (!nc) return NextResponse.json({ error: "Nota de crédito no encontrada" }, { status: 404 });
    if (nc.estado !== "activa") {
      return NextResponse.json(
        { error: nc.estado === "usada" ? "NC ya fue utilizada" : "NC inactiva" },
        { status: 409 }
      );
    }
    if (nc.fecha_vencimiento && new Date(nc.fecha_vencimiento) < new Date()) {
      return NextResponse.json({ error: "NC vencida" }, { status: 410 });
    }
    return NextResponse.json({ data: nc });
  }

  const ventaId = req.nextUrl.searchParams.get("ventaId");
  if (!ventaId) return NextResponse.json({ error: "ventaId required" }, { status: 400 });

  let query = supabase
    .from("notas_credito")
    .select("id, numero_nc, monto_total, motivo, tipo_reembolso, metodo_reembolso, estado, created_at, nota_credito_items(venta_item_id, cantidad_devuelta)")
    .eq("venta_id", ventaId);

  // systemAdmin puede ver notas de crédito de cualquier tienda
  if (!systemAdmin) {
    query = query.eq("store_id", store_id);
  }

  const { data: notas, error } = await query.order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Error al cargar notas de crédito" }, { status: 500 });
  return NextResponse.json({ data: notas ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id, systemAdmin } = ctx;
  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = NotaCreditoPostSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { ventaId, items, tipoReembolso, metodoReembolso, motivo } = parsed.data;

  let query = supabase
    .from("ventas")
    .select("id, cliente_id, total, subtotal, descuento, estado")
    .eq("id", ventaId);

  // systemAdmin puede procesar devoluciones de cualquier tienda
  if (!systemAdmin) {
    query = query.eq("store_id", store_id);
  }

  const { data: venta } = await query.single();

  if (!venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
  if (venta.estado === "anulada") return NextResponse.json({ error: "No se puede devolver una venta anulada" }, { status: 409 });

  // Para systemAdmin, el store_id se toma del contexto; para otros usuarios, ya está filtrado
  const venta_store_id = store_id;

  // Si la venta tiene descuento porcentual, cada item se devuelve al precio proporcional
  const descuentoPct = Number(venta.descuento ?? 0);
  const descuentoFactor = descuentoPct > 0 ? (100 - descuentoPct) / 100 : 1;

  const hoy = new Date();
  const numero_nc = `NC-${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}${String(hoy.getDate()).padStart(2, "0")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  let montoTotal = 0;
  let costoTotalNc = 0;
  const itemsConDetalles = [];

  for (const item of items) {
    if (!item.ventaItemId || !item.cantidadDevuelta || item.cantidadDevuelta <= 0) {
      return NextResponse.json({ error: "Items inválidos" }, { status: 400 });
    }
    const { data: ventaItem } = await supabase
      .from("venta_items")
      .select("id, producto_id, cantidad, precio_unitario, productos(costo)")
      .eq("id", item.ventaItemId)
      .eq("venta_id", ventaId)
      .single();

    if (!ventaItem) {
      return NextResponse.json({ error: "Item de venta no encontrado" }, { status: 400 });
    }

    const { data: devolucionesPrevias } = await supabase
      .from("nota_credito_items")
      .select("cantidad_devuelta, notas_credito!inner(venta_id)")
      .eq("venta_item_id", item.ventaItemId)
      .eq("notas_credito.venta_id", ventaId);

    const yaDevuelto = (devolucionesPrevias ?? []).reduce((sum, r) => sum + r.cantidad_devuelta, 0);
    const disponible = ventaItem.cantidad - yaDevuelto;

    if (item.cantidadDevuelta > disponible) {
      return NextResponse.json({ error: "Cantidad devuelta excede el disponible" }, { status: 400 });
    }

    // precio_unitario ya incluye IVA — aplicar descuento proporcional y redondear a pesos enteros
    const unitPrice = Number(ventaItem.precio_unitario);
    const precioConDescuento = Math.round(unitPrice * descuentoFactor);
    const subtotal = Math.round(item.cantidadDevuelta * unitPrice * descuentoFactor);
    montoTotal += subtotal;
    const restituirStock = item.restituirStock ?? true;
    // COGS solo se revierte para la porción efectivamente restituida al stock
    // (mismo criterio que anular_venta_tx, migración 053: si el producto no
    // vuelve a inventario, el costo de venta ya incurrido no se revierte).
    if (restituirStock) {
      const costoUnitario = Number(
        (ventaItem.productos as unknown as { costo: number } | null)?.costo ?? 0
      );
      costoTotalNc += item.cantidadDevuelta * costoUnitario;
    }
    itemsConDetalles.push({
      ventaItemId: item.ventaItemId,
      productoId: ventaItem.producto_id,
      cantidadDevuelta: item.cantidadDevuelta,
      precioUnitario: precioConDescuento,
      subtotal,
      restituirStock,
    });
  }

  if (montoTotal <= 0) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }

  const fechaVencimiento = new Date();
  fechaVencimiento.setDate(fechaVencimiento.getDate() + 30);

  const { data: nc, error: ncError } = await supabase
    .from("notas_credito")
    .insert({
      store_id: venta_store_id,
      venta_id: ventaId,
      numero_nc,
      motivo: motivo ?? null,
      tipo_reembolso: tipoReembolso,
      metodo_reembolso: metodoReembolso ?? null,
      monto_total: montoTotal,
      estado: "activa",
      fecha_vencimiento: fechaVencimiento.toISOString().split("T")[0],
    })
    .select()
    .single();

  if (ncError || !nc) {
    const { ipAddress, userAgent } = getRequestMetadata(req);
    logAudit({
      storeId: venta_store_id,
      userId: ctx.userId,
      action: "CREATE",
      entityType: "nota_credito",
      changeDescription: `Error creando nota de crédito para devolución de venta ${ventaId}`,
      ipAddress,
      userAgent,
      result: "failure",
      errorMessage: ncError?.message ?? "Unknown error",
    }).catch(() => {});
    return NextResponse.json({ error: "Error creando nota de crédito" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: venta_store_id,
    userId: ctx.userId,
    action: "CREATE",
    entityType: "nota_credito",
    entityId: nc.id,
    newValues: { monto_total: montoTotal, motivo: motivo ?? null, tipo_reembolso: tipoReembolso },
    changeDescription: `Nota de crédito creada por devolución de venta ${ventaId}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  const { error: itemsError } = await supabase.from("nota_credito_items").insert(
    itemsConDetalles.map((item) => ({
      nota_credito_id: nc.id,
      venta_item_id: item.ventaItemId,
      producto_id: item.productoId,
      cantidad_devuelta: item.cantidadDevuelta,
      precio_unitario: item.precioUnitario,
      subtotal: item.subtotal,
      restituir_stock: item.restituirStock,
    }))
  );

  if (itemsError) return NextResponse.json({ error: "Error creando items de NC" }, { status: 500 });

  const stockNcErrors: string[] = [];
  for (const item of itemsConDetalles) {
    if (item.restituirStock) {
      const { data: itemLotes } = await supabase
        .from("venta_item_lotes")
        .select("id")
        .eq("venta_item_id", item.ventaItemId)
        .limit(1);

      if (itemLotes && itemLotes.length > 0) {
        const { error: lotesErr } = await supabase.rpc("devolver_stock_a_lotes", {
          p_venta_item_id: item.ventaItemId,
        });
        if (lotesErr) stockNcErrors.push(`lotes producto ${item.productoId}: ${lotesErr.message}`);
      } else {
        const { data: prod } = await supabase
          .from("productos")
          .select("stock")
          .eq("id", item.productoId)
          .single();

        if (prod) {
          const { error: stockErr } = await supabase
            .from("productos")
            .update({ stock: prod.stock + item.cantidadDevuelta })
            .eq("id", item.productoId);
          if (stockErr) stockNcErrors.push(`producto ${item.productoId}: ${stockErr.message}`);
        }
      }

      const { error: movErr } = await supabase.from("stock_movements").insert({
        producto_id: item.productoId,
        tipo: "entrada",
        cantidad: item.cantidadDevuelta,
        referencia_id: nc.id,
        notas: `Devolución ${numero_nc}`,
        user_id: ctx.userId,
      });
      if (movErr) stockNcErrors.push(`stock_movement producto ${item.productoId}: ${movErr.message}`);
    }
  }

  if (stockNcErrors.length > 0) {
    return NextResponse.json({ error: `Error restaurando stock: ${stockNcErrors.join("; ")}` }, { status: 500 });
  }

  if (tipoReembolso === "saldo_a_favor" && venta.cliente_id) {
    // Incremento atómico (upsert de una sola sentencia vía RPC) — evita el
    // lost-update que existía con el patrón previo de leer saldo_disponible
    // en JS y recién después escribir el valor calculado.
    const { error: saldoErr } = await supabase.rpc("incrementar_saldo_a_favor", {
      p_store_id: venta_store_id,
      p_cliente_id: venta.cliente_id,
      p_monto: montoTotal,
    });

    if (saldoErr) {
      return NextResponse.json({ error: "Error actualizando saldo a favor del cliente" }, { status: 500 });
    }
  }

  if (venta.cliente_id) {
    const [{ data: fid }, { data: storeNiveles }] = await Promise.all([
      supabase
        .from("fidelizacion")
        .select("id, total_historico, frecuencia_compras")
        .eq("cliente_id", venta.cliente_id)
        .single(),
      supabase
        .from("stores")
        .select("fidelizacion_niveles")
        .eq("id", venta_store_id)
        .single(),
    ]);

    if (fid) {
      const nuevoTotal = Math.max(0, Number(fid.total_historico) - montoTotal);
      const nuevaFrecuencia = fid.frecuencia_compras;
      const niveles = ((storeNiveles?.fidelizacion_niveles as { monto: number; descuento: number }[] | null) ?? [
        { monto: 50000, descuento: 5 }, { monto: 150000, descuento: 10 }, { monto: 300000, descuento: 20 },
      ]).sort((a, b) => b.monto - a.monto);
      const nuevoDescuento = niveles.find((n) => nuevoTotal >= n.monto)?.descuento ?? 0;

      const { error: fidErr } = await supabase.from("fidelizacion").update({
        total_historico: nuevoTotal,
        descuento_actual: nuevoDescuento,
        updated_at: new Date().toISOString(),
      }).eq("cliente_id", venta.cliente_id);

      if (fidErr) {
        return NextResponse.json({ error: "Error actualizando fidelización del cliente" }, { status: 500 });
      }
    }
  }

  // Asiento contable (post-response fire-and-forget)
  (async () => {
    let clienteNombre: string | undefined;
    if (venta.cliente_id) {
      const { data: cli } = await supabase.from("clientes").select("nombre").eq("id", venta.cliente_id).single();
      clienteNombre = cli?.nombre ?? undefined;
    }

    const fechaNc = new Date().toISOString().split("T")[0];

    const asiento = await crearAsiento({
      storeId: venta_store_id,
      fecha: fechaNc,
      tipoMovimiento: "NOTA_CREDITO",
      canal: "pos",
      referenciaId: nc.id,
      referenciaNomero: numero_nc,
      descripcion: `Devolución${clienteNombre ? ` a ${clienteNombre}` : ""}${motivo ? ` — ${motivo}` : ""}`,
      lineas: lineasNotaCredito({ monto: montoTotal, tipoReembolso, metodoReembolso: metodoReembolso ?? undefined }),
      usuarioId: ctx.userId ?? undefined,
    });
    if (!asiento) console.error(`[contabilidad] Asiento NC NO CREADO para ${numero_nc}`);

    // Reverso de COGS — solo si hubo costo de mercancía efectivamente
    // restituida a inventario (ver acumulación de costoTotalNc arriba).
    if (costoTotalNc > 0) {
      const reversoCogs = await crearAsiento({
        storeId: venta_store_id,
        fecha: fechaNc,
        tipoMovimiento: "NOTA_CREDITO",
        canal: "pos",
        referenciaId: nc.id,
        referenciaNomero: numero_nc,
        descripcion: `Reverso COGS devolución${clienteNombre ? ` a ${clienteNombre}` : ""}`,
        lineas: lineasNotaCreditoCOGS(Math.round(costoTotalNc)),
        usuarioId: ctx.userId ?? undefined,
      });
      if (!reversoCogs) console.error(`[contabilidad] Reverso COGS NO CREADO para NC ${numero_nc}`);
    }
  })().catch((e) => console.error("[contabilidad] Error en asiento NC:", e));

  return NextResponse.json({
    ok: true,
    notaCreditoId: nc.id,
    numeroNc: numero_nc,
    montoNc: montoTotal,
    fechaVencimiento: fechaVencimiento.toISOString().split("T")[0],
  });
}
