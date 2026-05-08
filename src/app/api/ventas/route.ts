import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { sendWhatsAppText, buildReceiptMessage } from "@/lib/whatsapp";
import { syncPurchaseToHub, syncProductsToHub } from "@/lib/hub-sync";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { VentaCreateSchema } from "@/lib/validation";
import { crearAsiento, lineasVentaCanal, lineasVentaConNc } from "@/lib/contabilidad/generador-asientos";

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

  const { items, clienteId, metodoPago, descuentoPct, canal, procedencia, workerClerkId, pagoNc } = parsed.data;
  const numeroTransaccion = body.numeroTransaccion;
  const descuento_pct = descuentoPct ?? 0;

  // Additional validation for transaction numbers (only for non-NC rest payments)
  if (["debito", "credito", "transferencia"].includes(metodoPago) && !numeroTransaccion && !pagoNc) {
    return NextResponse.json(
      { error: `número de transacción requerido para ${metodoPago}` },
      { status: 400 }
    );
  }

  // Retrieve prices from productos — do not trust client-supplied prices
  const productoIds: string[] = items.map((i: { producto_id: string }) => i.producto_id);
  const { data: productosDB, error: precioError } = await supabase
    .from("productos")
    .select("id, precio, precio_oferta, en_oferta")
    .in("id", productoIds)
    .eq("store_id", store_id);

  if (precioError || !productosDB || productosDB.length !== productoIds.length) {
    return NextResponse.json(
      { error: "Uno o más productos no encontrados" },
      { status: 400 }
    );
  }
  // precio ya incluye IVA (precio al público)
  const precioMap = Object.fromEntries(productosDB.map((p) => [
    p.id,
    p.en_oferta && p.precio_oferta ? Number(p.precio_oferta) : Number(p.precio),
  ]));

  const itemsConPrecio = items.map((item: { producto_id: string; cantidad: number; mascota_id?: string }) => ({
    ...item,
    precio_unitario: precioMap[item.producto_id],
    subtotal: precioMap[item.producto_id] * item.cantidad,
  }));

  // precio_unitario ya incluye IVA (precio al público)
  const subtotal: number = itemsConPrecio.reduce(
    (sum: number, i: { subtotal: number }) => sum + i.subtotal,
    0
  );
  const descuentoMonto = (subtotal * descuento_pct) / 100;
  const total = Math.round((subtotal - descuentoMonto) * 100) / 100;
  const montoNetoVenta = Math.round((total / 1.19) * 100) / 100;
  const impuesto = Math.round((total - montoNetoVenta) * 100) / 100;

  // ── Validar NC si se paga con voucher ────────────────────────────────────
  let ncData: { id: string; monto_total: number; venta_id: string | null } | null = null;
  if (pagoNc) {
    const { data: nc } = await supabase
      .from("notas_credito")
      .select("id, numero_nc, monto_total, fecha_vencimiento, estado, venta_id")
      .eq("id", pagoNc.nota_credito_id)
      .eq("store_id", store_id)
      .single();

    if (!nc) return NextResponse.json({ error: "Nota de crédito no encontrada" }, { status: 404 });
    if (nc.estado !== "activa") return NextResponse.json({ error: "NC ya fue utilizada o está inactiva" }, { status: 409 });
    if (nc.fecha_vencimiento && new Date(nc.fecha_vencimiento) < new Date()) {
      return NextResponse.json({ error: "NC vencida" }, { status: 410 });
    }
    if (pagoNc.monto > Number(nc.monto_total)) {
      return NextResponse.json({ error: "Monto NC no coincide" }, { status: 400 });
    }
    ncData = { id: nc.id, monto_total: Number(nc.monto_total), venta_id: nc.venta_id };
  }
  // ─────────────────────────────────────────────────────────────────────────

  const hoy = new Date();
  const numero_comprobante = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}${String(hoy.getDate()).padStart(2, "0")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

   const metodoPagoVenta = pagoNc
     ? (pagoNc.monto >= total ? "nota_credito" : "mixto")
     : metodoPago;

   const { data: venta, error: ventaError } = await supabase
     .from("ventas")
     .insert({
       store_id,
       cliente_id: clienteId ?? null,
       worker_clerk_id: workerClerkId ?? null,
       subtotal,
       descuento: descuento_pct,
       impuesto,
       total,
       metodo_pago: metodoPagoVenta,
       canal,
       procedencia,
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
       newValues: { items, clienteId, workerClerkId, metodoPago, descuento: descuento_pct, numeroTransaccion },
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

const { data: ventaItems, error: itemsError } = await supabase
     .from("venta_items")
     .insert(
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
     )
     .select();

   if (itemsError) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  // Registrar pago(s)
  if (pagoNc && ncData) {
    const pagosInsert = [
      {
        store_id,
        venta_id: venta.id,
        metodo: "nota_credito",
        monto: pagoNc.monto,
        nota_credito_id: ncData.id,
        numero_transaccion: pagoNc.numero_nc,
      },
    ];

    const montoResto = Math.round((total - pagoNc.monto) * 100) / 100;
    if (montoResto > 0) {
      pagosInsert.push({
        store_id,
        venta_id: venta.id,
        metodo: metodoPago,
        monto: montoResto,
        nota_credito_id: null as unknown as string,
        numero_transaccion: numeroTransaccion ?? null as unknown as string,
      });
    }

    const { error: pagoError } = await supabase.from("pagos").insert(pagosInsert);
    if (pagoError) return NextResponse.json({ error: "Error registrando pago" }, { status: 500 });

    // Marcar NC como usada
    await supabase
      .from("notas_credito")
      .update({ estado: "usada" })
      .eq("id", ncData.id);

    // Deducir de saldos_a_favor si la NC tiene cliente de origen
    if (ncData.venta_id) {
      const { data: ventaOrigen } = await supabase
        .from("ventas")
        .select("cliente_id")
        .eq("id", ncData.venta_id)
        .single();

      if (ventaOrigen?.cliente_id) {
        const { data: saldo } = await supabase
          .from("saldos_a_favor")
          .select("saldo_disponible")
          .eq("cliente_id", ventaOrigen.cliente_id)
          .eq("store_id", store_id)
          .single();

        if (saldo) {
          const nuevoSaldo = Math.max(0, Number(saldo.saldo_disponible) - pagoNc.monto);
          await supabase
            .from("saldos_a_favor")
            .update({ saldo_disponible: nuevoSaldo, updated_at: new Date().toISOString() })
            .eq("cliente_id", ventaOrigen.cliente_id)
            .eq("store_id", store_id);
        }
      }
    }
  } else {
    const { error: pagoError } = await supabase.from("pagos").insert({
      store_id,
      venta_id: venta.id,
      metodo: metodoPago,
      monto: total,
      numero_transaccion: numeroTransaccion ?? null,
    });
    if (pagoError) return NextResponse.json({ error: "Error registrando pago" }, { status: 500 });
  }

  // Actualizar estado de venta a pagada
  await supabase.from("ventas").update({ estado: "pagada" }).eq("id", venta.id);

for (const item of itemsConPrecio as { producto_id: string; cantidad: number; mascota_id?: string }[]) {
     const ventaItem = (ventaItems ?? []).find(vi => vi.producto_id === item.producto_id && vi.cantidad === item.cantidad);
     if (!ventaItem) continue;

const { count } = await supabase
        .from("lotes_producto")
        .select("id", { count: "exact", head: true })
        .eq("producto_id", item.producto_id)
        .eq("store_id", store_id)
        .eq("activo", true)
        .gt("cantidad_actual", 0);

      if ((count ?? 0) > 0) {
       const { error: fifoError } = await supabase.rpc("deducir_stock_fifo", {
         p_producto_id:   item.producto_id,
         p_store_id:      store_id,
         p_cantidad:      item.cantidad,
         p_venta_item_id: ventaItem.id,
       });
       if (fifoError) return NextResponse.json({ error: "Stock insuficiente para completar la venta." }, { status: 422 });
     } else {
       await supabase.rpc("decrement_stock", {
         p_producto_id: item.producto_id,
         p_cantidad:    item.cantidad,
       });
     }

     await supabase.from("stock_movements").insert({
       producto_id: item.producto_id,
       tipo: "salida",
       cantidad: -item.cantidad,
       referencia_id: venta.id,
       notas: `Venta ${venta.id}`,
     });

    // Calcular alerta de consumo si hay mascota y config definida
    if (item.mascota_id) {
      const { data: producto } = await supabase
        .from("productos")
        .select("peso_gramos, categorias(es_alimento)")
        .eq("id", item.producto_id)
        .single();

      const cats = producto?.categorias as { es_alimento: boolean }[] | null;
      const cat = Array.isArray(cats) ? cats[0] : cats;
      if (!cat?.es_alimento || !producto?.peso_gramos) continue;

      const { data: configPrincipal } = await supabase
        .from("consumo_configs")
        .select("cliente_id, gramos_porcion, veces_dia")
        .eq("mascota_id", item.mascota_id)
        .eq("producto_id", item.producto_id)
        .single();

      if (!configPrincipal || configPrincipal.gramos_porcion <= 0) continue;

      const { data: todosLosConfigs } = await supabase
        .from("consumo_configs")
        .select("mascota_id, gramos_porcion, veces_dia")
        .eq("cliente_id", configPrincipal.cliente_id)
        .eq("producto_id", item.producto_id);

      const consumoDiarioTotal = (todosLosConfigs ?? []).reduce(
        (sum, c) => sum + (c.gramos_porcion * c.veces_dia),
        0
      );

      if (consumoDiarioTotal <= 0) continue;

      const totalGramos = item.cantidad * producto.peso_gramos;
      const diasEstimados = Math.round(totalGramos / consumoDiarioTotal);
      const fechaTermino = new Date();
      fechaTermino.setDate(fechaTermino.getDate() + diasEstimados);
      const fechaTerminoStr = fechaTermino.toISOString().split("T")[0];

      const { data: storeConfig } = await supabase
        .from("stores")
        .select("email_reminder_dias_aviso")
        .eq("id", store_id)
        .single();
      const diasAviso = storeConfig?.email_reminder_dias_aviso ?? 5;

      for (const cfg of (todosLosConfigs ?? [])) {
        await supabase.from("consumo_alertas").upsert(
          {
            store_id,
            cliente_id: configPrincipal.cliente_id,
            mascota_id: cfg.mascota_id,
            producto_id: item.producto_id,
            fecha_estimada_termino: fechaTerminoStr,
            dias_aviso: diasAviso,
            enviado: false,
          },
          { onConflict: "mascota_id,producto_id" }
        );
      }
    }
  }

  // Sync stock al hub (fire-and-forget) - independientemente de si hay cliente
  const syncedProductoIds = itemsConPrecio.map((i) => i.producto_id);
  const { data: productosActualizados } = await supabase
    .from("productos")
    .select("id, nombre, marca, codigo_barra, precio, stock, activo")
    .eq("store_id", store_id)
    .in("id", syncedProductoIds);

  if (productosActualizados && productosActualizados.length > 0) {
    syncProductsToHub(
      productosActualizados.map((p) => ({
        producto_id: p.id,
        nombre_producto: p.nombre,
        marca: p.marca ?? undefined,
        codigo_barra: p.codigo_barra ?? null,
        precio: Number(p.precio),
        stock: p.stock,
        activo: p.activo ?? true,
      }))
    );
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

  const lineasAsiento = pagoNc
    ? lineasVentaConNc({
        montoNeto,
        iva: ivaCalc,
        total,
        montoNc: pagoNc.monto,
        montoResto: Math.round((total - pagoNc.monto) * 100) / 100,
        metodoPagoResto: metodoPago,
      })
    : lineasVentaCanal({ canal, metodoPago, montoNeto, iva: ivaCalc, total });

  crearAsiento({
    storeId: store_id,
    fecha: venta.created_at?.split("T")[0] ?? new Date().toISOString().split("T")[0],
    tipoMovimiento: "VENTA",
    canal,
    referenciaId: venta.id,
    referenciaNomero: venta.numero_comprobante,
    descripcion: `Venta ${canal.toUpperCase()} ${metodoPagoVenta} - ${venta.numero_comprobante}`,
    lineas: lineasAsiento,
    usuarioId: ctx.userId ?? undefined,
  }).catch((e) => console.error("[contabilidad] Error asiento venta:", e));

  return NextResponse.json(venta);
}
