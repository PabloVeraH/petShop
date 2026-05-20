import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { NotaCreditoPostSchema } from "@/lib/validation";
import { crearAsiento, lineasNotaCredito } from "@/lib/contabilidad/generador-asientos";
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
    .select("id, cliente_id, total, subtotal, estado")
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

  const hoy = new Date();
  const numero_nc = `NC-${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}${String(hoy.getDate()).padStart(2, "0")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  let montoTotal = 0;
  const itemsConDetalles = [];

  for (const item of items) {
    if (!item.ventaItemId || !item.cantidadDevuelta || item.cantidadDevuelta <= 0) {
      return NextResponse.json({ error: "Items inválidos" }, { status: 400 });
    }
    const { data: ventaItem } = await supabase
      .from("venta_items")
      .select("id, producto_id, cantidad, precio_unitario")
      .eq("id", item.ventaItemId)
      .single();

    if (!ventaItem) {
      return NextResponse.json({ error: "Item de venta no encontrado" }, { status: 400 });
    }

    const { data: devolucionesPrevias } = await supabase
      .from("nota_credito_items")
      .select("cantidad_devuelta")
      .eq("venta_item_id", item.ventaItemId);

    const yaDevuelto = (devolucionesPrevias ?? []).reduce((sum, r) => sum + r.cantidad_devuelta, 0);
    const disponible = ventaItem.cantidad - yaDevuelto;

    if (item.cantidadDevuelta > disponible) {
      return NextResponse.json({ error: "Cantidad devuelta excede el disponible" }, { status: 400 });
    }

    // precio_unitario ya incluye IVA
    const subtotal = Math.round(item.cantidadDevuelta * Number(ventaItem.precio_unitario) * 100) / 100;
    montoTotal += subtotal;
    itemsConDetalles.push({
      ventaItemId: item.ventaItemId,
      productoId: ventaItem.producto_id,
      cantidadDevuelta: item.cantidadDevuelta,
      precioUnitario: Number(ventaItem.precio_unitario),
      subtotal,
      restituirStock: item.restituirStock ?? true,
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

  for (const item of itemsConDetalles) {
    if (item.restituirStock) {
      const { data: itemLotes } = await supabase
        .from("venta_item_lotes")
        .select("id")
        .eq("venta_item_id", item.ventaItemId)
        .limit(1);

      if (itemLotes && itemLotes.length > 0) {
        await supabase.rpc("devolver_stock_a_lotes", {
          p_venta_item_id: item.ventaItemId,
        });
      } else {
        const { data: prod } = await supabase
          .from("productos")
          .select("stock")
          .eq("id", item.productoId)
          .single();

        if (prod) {
          await supabase
            .from("productos")
            .update({ stock: prod.stock + item.cantidadDevuelta })
            .eq("id", item.productoId);
        }
      }

      await supabase.from("stock_movements").insert({
        producto_id: item.productoId,
        tipo: "entrada",
        cantidad: item.cantidadDevuelta,
        referencia_id: nc.id,
        notas: `Devolución ${numero_nc}`,
      });
    }
  }

  if (tipoReembolso === "saldo_a_favor" && venta.cliente_id) {
    const { data: saldo } = await supabase
      .from("saldos_a_favor")
      .select("saldo_disponible")
      .eq("cliente_id", venta.cliente_id)
      .eq("store_id", venta_store_id)
      .single();

    const nuevoSaldo = (Number(saldo?.saldo_disponible ?? 0) + montoTotal).toFixed(2);

    await supabase.from("saldos_a_favor").upsert(
      {
        store_id: venta_store_id,
        cliente_id: venta.cliente_id,
        saldo_disponible: parseFloat(nuevoSaldo),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id,cliente_id" }
    );
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
      const nuevaFrecuencia = fid.frecuencia_compras; // No decrementamos aquí, solo en anulación total
      const niveles = ((storeNiveles?.fidelizacion_niveles as { monto: number; descuento: number }[] | null) ?? [
        { monto: 50000, descuento: 5 }, { monto: 150000, descuento: 10 }, { monto: 300000, descuento: 20 },
      ]).sort((a, b) => b.monto - a.monto);
      const nuevoDescuento = niveles.find((n) => nuevoTotal >= n.monto)?.descuento ?? 0;

      await supabase.from("fidelizacion").update({
        total_historico: nuevoTotal,
        descuento_actual: nuevoDescuento,
        updated_at: new Date().toISOString(),
      }).eq("cliente_id", venta.cliente_id);
    }
  }

  crearAsiento({
    storeId: venta_store_id,
    fecha: new Date().toISOString().split("T")[0],
    tipoMovimiento: "NOTA_CREDITO",
    canal: "pos",
    referenciaId: nc.id,
    referenciaNomero: numero_nc,
    descripcion: `Nota de Crédito ${numero_nc}`,
    lineas: lineasNotaCredito({ monto: montoTotal, tipoReembolso, metodoReembolso: metodoReembolso ?? undefined }),
    usuarioId: ctx.userId ?? undefined,
  }).catch((e) => console.error("[contabilidad] Error asiento NC:", e));

  return NextResponse.json({
    ok: true,
    notaCreditoId: nc.id,
    numeroNc: numero_nc,
    montoNc: montoTotal,
    fechaVencimiento: fechaVencimiento.toISOString().split("T")[0],
  });
}
