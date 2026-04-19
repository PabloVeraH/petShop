import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { sendWhatsAppText, buildReceiptMessage } from "@/lib/whatsapp";
import { syncPurchaseToHub } from "@/lib/hub-sync";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { VentaCreateSchema } from "@/lib/validation";
import { crearAsiento, lineasVentaCanal } from "@/lib/contabilidad/generador-asientos";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const search = req.nextUrl.searchParams.get("search") ?? "";
  const metodo = req.nextUrl.searchParams.get("metodo") ?? "";
  const estado = req.nextUrl.searchParams.get("estado") ?? "";
  const desde = req.nextUrl.searchParams.get("desde") ?? "";
  const hasta = req.nextUrl.searchParams.get("hasta") ?? "";
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");
  const LIMIT = 50;

  // If searching by client name, pre-filter to enable server-side search + correct pagination
  if (search) {
    // Try searching by sale number first
    let query = supabase
      .from("ventas")
      .select("id, total, metodo_pago, estado, created_at, numero_comprobante, clientes(nombre)", { count: "exact" })
      .eq("store_id", store_id)
      .order("created_at", { ascending: false })
      .range(offset, offset + LIMIT - 1);

    // Check if search looks like a sale number (contains -)
    if (search.includes("-")) {
      query = query.ilike("numero_comprobante", `%${search}%`);
    } else {
      // Search by client name
      const { data: matchingClientes } = await supabase
        .from("clientes")
        .select("id")
        .eq("store_id", store_id)
        .ilike("nombre", `%${search}%`);
      const clienteIds = matchingClientes?.map((c) => c.id) ?? [];
      if (clienteIds.length === 0) return NextResponse.json({ data: [], count: 0 });
      query = query.in("cliente_id", clienteIds);
    }

    if (metodo) query = query.eq("metodo_pago", metodo);
    if (estado) query = query.eq("estado", estado);
    if (desde) query = query.gte("created_at", desde);
    if (hasta) query = query.lte("created_at", hasta + "T23:59:59");
    const { data, error, count } = await query;
    if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    return NextResponse.json({ data: data ?? [], count: count ?? 0 });
  }

  let query = supabase
    .from("ventas")
    .select("id, total, metodo_pago, estado, created_at, numero_comprobante, clientes(nombre)", { count: "exact" })
    .eq("store_id", store_id)
    .order("created_at", { ascending: false })
    .range(offset, offset + LIMIT - 1);

  if (metodo) query = query.eq("metodo_pago", metodo);
  if (estado) query = query.eq("estado", estado);
  if (desde) query = query.gte("created_at", desde);
  if (hasta) query = query.lte("created_at", hasta + "T23:59:59");

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  return NextResponse.json({ data: data ?? [], count: count ?? 0 });
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = VentaCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { items, clienteId, metodoPago, descuento, canal } = parsed.data;
  const numeroTransaccion = body.numeroTransaccion;
  const vendedorId = body.vendedorId;
  const descuento_pct = descuento ?? 0;

  // Additional validation for transaction numbers
  if (["debito", "credito", "transferencia"].includes(metodoPago) && !numeroTransaccion) {
    return NextResponse.json(
      { error: `número de transacción requerido para ${metodoPago}` },
      { status: 400 }
    );
  }

  // Retrieve prices from canal_producto_config — do not trust client-supplied prices
  const productoIds: string[] = items.map((i: { producto_id: string }) => i.producto_id);
  const { data: preciosCanal, error: precioError } = await supabase
    .from("canal_producto_config")
    .select("producto_id, precio")
    .eq("store_id", store_id)
    .eq("canal_id", canal)
    .eq("activo", true)
    .in("producto_id", productoIds);

  if (precioError || !preciosCanal || preciosCanal.length !== productoIds.length) {
    return NextResponse.json(
      { error: "Uno o más productos no disponibles en este canal" },
      { status: 400 }
    );
  }
  const precioMap = Object.fromEntries(preciosCanal.map((p) => [p.producto_id, Number(p.precio)]));

  const itemsConPrecio = items.map((item: { producto_id: string; cantidad: number; mascota_id?: string }) => ({
    ...item,
    precio_unitario: precioMap[item.producto_id],
    subtotal: precioMap[item.producto_id] * item.cantidad,
  }));

  const subtotal: number = itemsConPrecio.reduce(
    (sum: number, i: { subtotal: number }) => sum + i.subtotal,
    0
  );
  const descuentoMonto = (subtotal * descuento_pct) / 100;
  const impuesto = (subtotal - descuentoMonto) * 0.19;
  const total = (subtotal - descuentoMonto) * 1.19;

  const hoy = new Date();
  const numero_comprobante = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}${String(hoy.getDate()).padStart(2, "0")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

   const { data: venta, error: ventaError } = await supabase
     .from("ventas")
     .insert({
       store_id,
       cliente_id: clienteId ?? null,
       vendedor_id: vendedorId ?? null,
       subtotal,
       descuento,
       impuesto,
       total,
       metodo_pago: metodoPago,
       canal,
       estado: "completada",
       numero_comprobante,
     })
     .select()
     .single();

   if (ventaError) {
     await logAudit({
       storeId: store_id,
       userId: ctx.userId || "unknown",
       action: "CREATE",
       entityType: "venta",
       newValues: { items, clienteId, vendedorId, metodoPago, descuento: descuento_pct, numeroTransaccion },
       ipAddress: (await getRequestMetadata(req)).ipAddress,
       userAgent: (await getRequestMetadata(req)).userAgent,
       result: "failure",
       errorMessage: ventaError.message,
     });
     return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
   }

   // Log successful venta creation
   await logAudit({
     storeId: store_id,
     userId: ctx.userId || "unknown",
     action: "CREATE",
     entityType: "venta",
     entityId: venta.id,
     newValues: venta,
     changeDescription: `Venta creada por $${venta.total} con ${items.length} items`,
     ipAddress: (await getRequestMetadata(req)).ipAddress,
     userAgent: (await getRequestMetadata(req)).userAgent,
     result: "success",
   });

  const { error: itemsError } = await supabase.from("venta_items").insert(
    itemsConPrecio.map((item: {
      producto_id: string;
      cantidad: number;
      precio_unitario: number;
      subtotal: number;
      mascota_id?: string;
    }) => ({
      venta_id: venta.id,
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      subtotal: item.subtotal,
      mascota_id: item.mascota_id ?? null,
    }))
  );

  if (itemsError) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  // Registrar pago
  const { error: pagoError } = await supabase.from("pagos").insert({
    store_id,
    venta_id: venta.id,
    metodo: metodoPago,
    monto: total,
    numero_transaccion: numeroTransaccion ?? null,
  });

  if (pagoError) return NextResponse.json({ error: "Error registrando pago" }, { status: 500 });

  // Actualizar estado de venta a pagada
  await supabase.from("ventas").update({ estado: "pagada" }).eq("id", venta.id);

  for (const item of itemsConPrecio as { producto_id: string; cantidad: number; mascota_id?: string }[]) {
    await supabase.rpc("decrement_stock", {
      p_producto_id: item.producto_id,
      p_cantidad: item.cantidad,
    });
    await supabase.from("stock_movements").insert({
      producto_id: item.producto_id,
      tipo: "salida",
      cantidad: -item.cantidad,
      referencia_id: venta.id,
      notas: `Venta ${venta.id}`,
    });

    // Calcular alerta de consumo si hay mascota y config definida
    if (item.mascota_id) {
      const { data: config } = await supabase
        .from("consumo_configs")
        .select("id, cliente_id, gramos_porcion, veces_dia")
        .eq("mascota_id", item.mascota_id)
        .eq("producto_id", item.producto_id)
        .single();

      const { data: producto } = await supabase
        .from("productos")
        .select("peso_gramos")
        .eq("id", item.producto_id)
        .single();

      if (config && producto?.peso_gramos && config.gramos_porcion > 0 && config.veces_dia > 0) {
        const consumoDiario = config.gramos_porcion * config.veces_dia;
        const diasEstimados = Math.round((item.cantidad * producto.peso_gramos) / consumoDiario);
        const fechaTermino = new Date();
        fechaTermino.setDate(fechaTermino.getDate() + diasEstimados);

        await supabase.from("consumo_alertas").upsert(
          {
            store_id,
            cliente_id: config.cliente_id,
            mascota_id: item.mascota_id,
            producto_id: item.producto_id,
            fecha_estimada_termino: fechaTermino.toISOString().split("T")[0],
            dias_aviso: 7,
            enviado: false,
          },
          { onConflict: "mascota_id,producto_id" }
        );
      }
    }
  }

  // Actualizar fidelización si hay cliente
  if (clienteId) {
    const { data: fid } = await supabase
      .from("fidelizacion")
      .select("id, total_historico, frecuencia_compras")
      .eq("cliente_id", clienteId)
      .single();

    const nuevoTotal = Number(fid?.total_historico ?? 0) + total;
    const nuevaFrecuencia = (fid?.frecuencia_compras ?? 0) + 1;
    const nuevoDescuento =
      nuevoTotal >= 300_000 ? 20 :
      nuevoTotal >= 150_000 ? 10 :
      nuevoTotal >= 50_000  ?  5 : 0;

    await supabase.from("fidelizacion").upsert(
      {
        cliente_id: clienteId,
        total_historico: nuevoTotal,
        frecuencia_compras: nuevaFrecuencia,
        descuento_actual: nuevoDescuento,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cliente_id" }
    );
  }

  // Sync compra al hub (fire-and-forget) si el cliente tiene RUT
  if (clienteId) {
    const { data: clienteRut } = await supabase
      .from("clientes")
      .select("rut")
      .eq("id", clienteId)
      .single();
    if (clienteRut?.rut) syncPurchaseToHub(clienteRut.rut, total);
  }

  // Auto-send WhatsApp receipt if store has it enabled and cliente has phone
  if (clienteId) {
    const { data: store } = await supabase
      .from("stores")
      .select("name, whatsapp_enabled, whatsapp_phone_number_id, whatsapp_access_token")
      .eq("id", store_id)
      .single();

    if (store?.whatsapp_enabled && store.whatsapp_phone_number_id && store.whatsapp_access_token) {
      const { data: cliente } = await supabase
        .from("clientes")
        .select("nombre, telefono")
        .eq("id", clienteId)
        .single();

      if (cliente?.telefono) {
        const { data: ventaItemsWA } = await supabase
          .from("venta_items")
          .select("cantidad, subtotal, productos(nombre)")
          .eq("venta_id", venta.id);

        const waItems = (ventaItemsWA ?? []).map((i) => {
          const prod = i.productos as unknown as { nombre: string } | null;
          return { nombre: prod?.nombre ?? "Producto", cantidad: i.cantidad, subtotal: Number(i.subtotal) };
        });

        const msg = buildReceiptMessage({
          storeName: store.name,
          numeroComprobante: numero_comprobante,
          clienteNombre: cliente.nombre,
          items: waItems,
          total,
          metodoPago: metodoPago,
        });

        await sendWhatsAppText(
          { phoneNumberId: store.whatsapp_phone_number_id, accessToken: store.whatsapp_access_token },
          cliente.telefono,
          msg
        );
      }
    }
  }

  // Generar asiento contable (fire-and-forget — no bloquea la respuesta)
  const montoNeto = Math.round((total / 1.19) * 100) / 100;
  const ivaCalc = Math.round((total - montoNeto) * 100) / 100;
  crearAsiento({
    storeId: store_id,
    fecha: venta.created_at?.split("T")[0] ?? new Date().toISOString().split("T")[0],
    tipoMovimiento: "VENTA",
    canal,
    referenciaId: venta.id,
    referenciaNomero: venta.numero_comprobante,
    descripcion: `Venta ${canal.toUpperCase()} ${metodoPago} - ${venta.numero_comprobante}`,
    lineas: lineasVentaCanal({ canal, metodoPago, montoNeto, iva: ivaCalc, total }),
    usuarioId: ctx.userId ?? undefined,
  }).catch((e) => console.error("[contabilidad] Error asiento venta:", e));

  return NextResponse.json(venta);
}
