import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { NotaCreditoPostSchema } from "@/lib/validation";
import { crearAsiento, lineasNotaCredito } from "@/lib/contabilidad/generador-asientos";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id, systemAdmin } = ctx;
  const supabase = createServiceClient();

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

    if (!ventaItem || ventaItem.cantidad < item.cantidadDevuelta) {
      return NextResponse.json({ error: "Cantidad devuelta excede original" }, { status: 400 });
    }

    const subtotal = item.cantidadDevuelta * Number(ventaItem.precio_unitario);
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
    })
    .select()
    .single();

  if (ncError || !nc) return NextResponse.json({ error: "Error creando nota de crédito" }, { status: 500 });

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

        await supabase.from("stock_movements").insert({
          producto_id: item.productoId,
          tipo: "entrada",
          cantidad: item.cantidadDevuelta,
          referencia_id: nc.id,
          notas: `Devolución ${numero_nc}`,
        });
      }
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
    const { data: fid } = await supabase
      .from("fidelizacion")
      .select("id, total_historico, frecuencia_compras")
      .eq("cliente_id", venta.cliente_id)
      .single();

    if (fid) {
      const nuevoTotal = Math.max(0, Number(fid.total_historico) - montoTotal);
      const nuevaFrecuencia = fid.frecuencia_compras; // No decrementamos aquí, solo en anulación total
      const nuevoDescuento =
        nuevoTotal >= 300_000 ? 20 :
        nuevoTotal >= 150_000 ? 10 :
        nuevoTotal >= 50_000 ? 5 : 0;

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
    lineas: lineasNotaCredito({ monto: montoTotal, tipoReembolso }),
    usuarioId: ctx.userId ?? undefined,
  }).catch((e) => console.error("[contabilidad] Error asiento NC:", e));

  return NextResponse.json({ ok: true, notaCreditoId: nc.id, numeroNc: numero_nc });
}
