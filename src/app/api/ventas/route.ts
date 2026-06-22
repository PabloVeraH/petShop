import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { IVA_RATE } from "@/lib/tax";
import { createServiceClient } from "@/lib/supabase";
import { sendWhatsAppText, buildReceiptMessage } from "@/lib/whatsapp";
import { sendBoletaEmail } from "@/lib/email";
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
  try {
    return await postVenta(req);
  } catch (e) {
    console.error("[ventas POST] Unhandled error:", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

async function postVenta(req: NextRequest) {
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
  const enviarEmail = body.enviarEmail === true;
  const descuento_pct = descuentoPct ?? 0;

  if (["debito", "credito", "transferencia"].includes(metodoPago) && !numeroTransaccion && !pagoNc) {
    return NextResponse.json(
      { error: `número de transacción requerido para ${metodoPago}` },
      { status: 400 }
    );
  }

  // Retrieve prices from productos — do not trust client-supplied prices
  const productoIds: string[] = items.map((i: { producto_id: string }) => i.producto_id);
  const uniqueProductoIds = [...new Set(productoIds)];
  const { data: productosDB, error: precioError } = await supabase
    .from("productos")
    .select("id, precio, precio_oferta, en_oferta, precio_venta_kg")
    .in("id", uniqueProductoIds)
    .eq("store_id", store_id);

  if (precioError || !productosDB || productosDB.length !== uniqueProductoIds.length) {
    return NextResponse.json({ error: "Uno o más productos no encontrados" }, { status: 400 });
  }

   const precioMap: Record<string, number> = {};
   const granelSinPrecioKg: string[] = [];

   productosDB.forEach(p => {
     const itemDelCarrito = items.find(i => i.producto_id === p.id);
     if (itemDelCarrito?.es_granel) {
       if (p.precio_venta_kg) {
         precioMap[p.id] = Number(p.precio_venta_kg);
       } else {
         // Rechazar explícitamente — caer al precio de lista sería un sobrecargo silencioso
         granelSinPrecioKg.push(p.id);
       }
     } else {
       precioMap[p.id] = p.en_oferta && p.precio_oferta ? Number(p.precio_oferta) : Number(p.precio);
     }
   });

   if (granelSinPrecioKg.length > 0) {
     return NextResponse.json(
       { error: "Producto granel sin precio_venta_kg configurado — configure el precio por kg antes de vender a granel" },
       { status: 400 }
     );
   }

   const itemsConPrecio = items.map((item: {
     producto_id: string;
     cantidad: number;     // kg para granel, unidades enteras para normal
     mascota_id?: string;
     es_granel?: boolean;
     gramos?: number;
   }) => {
     const precio = precioMap[item.producto_id];
     const subtotal = item.es_granel
       ? item.cantidad * precio    // cantidad=kg, precio=precio_venta_kg
       : precio * item.cantidad;

     return {
       producto_id:     item.producto_id,
       cantidad:        item.cantidad,
       precio_unitario: precio,
       subtotal,
       mascota_id:      item.mascota_id ?? null,
       es_granel:       item.es_granel ?? false,
       gramos:          item.gramos ?? null,
     };
   });

  const subtotal: number = itemsConPrecio.reduce((sum: number, i: { subtotal: number }) => sum + i.subtotal, 0);
  const descuentoMonto = (subtotal * descuento_pct) / 100;
  const total = Math.round(subtotal - descuentoMonto);
  const impuesto = Math.round(total * IVA_RATE / (1 + IVA_RATE));
  const montoNetoVenta = total - impuesto;

  // Validar NC antes de abrir la transacción
  if (pagoNc) {
    const { data: nc } = await supabase
      .from("notas_credito")
      .select("id, monto_total, fecha_vencimiento, estado")
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
  }

  // Fetch store config (needed by RPC for consumo_alertas y fidelizacion)
  const { data: storeConfig } = await supabase
    .from("stores")
    .select("name, email_reminder_dias_aviso, fidelizacion_niveles, whatsapp_enabled, whatsapp_phone_number_id, whatsapp_access_token, rut, resend_from_email")
    .eq("id", store_id)
    .single();

  const diasAviso = storeConfig?.email_reminder_dias_aviso ?? 5;
  const fidelizacionNiveles = (storeConfig?.fidelizacion_niveles as { monto: number; descuento: number }[] | null) ?? [
    { monto: 50000, descuento: 5 },
    { monto: 150000, descuento: 10 },
    { monto: 300000, descuento: 20 },
  ];

  const hoy = new Date();
  const numero_comprobante = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}${String(hoy.getDate()).padStart(2, "0")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  // ── Transacción ACID en una sola llamada RPC ──────────────────────────────
  const { data: ventaResult, error: txError } = await supabase.rpc("crear_venta_tx", {
    p_store_id:             store_id,
    p_items:                itemsConPrecio,
    p_cliente_id:           clienteId ?? null,
    p_worker_clerk_id:      workerClerkId ?? null,
    p_subtotal:             subtotal,
    p_descuento_pct:        descuento_pct,
    p_impuesto:             impuesto,
    p_total:                total,
    p_metodo_pago:          metodoPago,
    p_canal:                canal,
    p_procedencia:          procedencia,
    p_numero_comprobante:   numero_comprobante,
    p_pago_nc:              pagoNc ?? null,
    p_numero_transaccion:   numeroTransaccion ?? null,
    p_fidelizacion_niveles: fidelizacionNiveles,
    p_dias_aviso:           diasAviso,
  });

  if (txError) {
    await logAudit({
      storeId: store_id,
      userId: ctx.userId || "unknown",
      action: "CREATE",
      entityType: "venta",
      newValues: { items, clienteId, workerClerkId, metodoPago, descuento: descuento_pct, numeroTransaccion },
      ipAddress: (await getRequestMetadata(req)).ipAddress,
      userAgent: (await getRequestMetadata(req)).userAgent,
      result: "failure",
      errorMessage: txError.message,
    });
    const isStockError = txError.message.toLowerCase().includes("stock") || txError.message.toLowerCase().includes("insuficiente");
    return NextResponse.json(
      { error: isStockError ? "Stock insuficiente para completar la venta." : "Error interno del servidor" },
      { status: isStockError ? 422 : 500 }
    );
  }

  const venta = ventaResult as Record<string, unknown>;
  const metodoPagoVenta = pagoNc
    ? (pagoNc.monto >= total ? "nota_credito" : "mixto")
    : metodoPago;

  await logAudit({
    storeId: store_id,
    userId: ctx.userId || "unknown",
    action: "CREATE",
    entityType: "venta",
    entityId: venta.id as string,
    newValues: venta,
    changeDescription: `Venta creada por $${venta.total} con ${items.length} items`,
    ipAddress: (await getRequestMetadata(req)).ipAddress,
    userAgent: (await getRequestMetadata(req)).userAgent,
    result: "success",
  });

  // ── Fire-and-forget: hub sync, WhatsApp, email, contabilidad ─────────────

  // Sync stock al hub
  const { data: productosActualizados } = await supabase
    .from("productos")
    .select("id, nombre, marca, codigo_barra, precio, stock, activo, tipo_animal, peso_gramos, en_oferta, precio_oferta, imagen_url, categorias(nombre)")
    .eq("store_id", store_id)
    .in("id", productoIds);

  if (productosActualizados && productosActualizados.length > 0) {
    syncProductsToHub(
      productosActualizados.map((p) => ({
        producto_id: p.id,
        nombre_producto: p.nombre,
        marca: p.marca ?? undefined,
        codigo_barra: p.codigo_barra ?? null,
        precio: Number(p.precio),
        stock: p.stock,
        tipo_animal: p.tipo_animal ?? undefined,
        peso_gramos: p.peso_gramos ?? undefined,
        precio_oferta: p.precio_oferta ? Number(p.precio_oferta) : undefined,
        en_oferta: p.en_oferta ?? false,
        categoria: (p.categorias as unknown as { nombre: string } | null)?.nombre ?? undefined,
        imagen_url: p.imagen_url ?? null,
        activo: p.activo ?? true,
      }))
    );
  }

  // Sync compra al hub si el cliente tiene RUT
  if (clienteId) {
    const { data: clienteRut } = await supabase
      .from("clientes")
      .select("rut")
      .eq("id", clienteId)
      .single();
    if (clienteRut?.rut) syncPurchaseToHub(clienteRut.rut, total);
  }

  // WhatsApp receipt
  if (clienteId && storeConfig?.whatsapp_enabled && storeConfig.whatsapp_phone_number_id && storeConfig.whatsapp_access_token) {
    const { data: cliente } = await supabase
      .from("clientes")
      .select("nombre, telefono")
      .eq("id", clienteId)
      .single();

    if (cliente?.telefono) {
      const { data: ventaItemsWA } = await supabase
        .from("venta_items")
        .select("cantidad, subtotal, productos(nombre)")
        .eq("venta_id", venta.id as string);

      const waItems = (ventaItemsWA ?? []).map((i) => {
        const prod = i.productos as unknown as { nombre: string } | null;
        return { nombre: prod?.nombre ?? "Producto", cantidad: i.cantidad, subtotal: Number(i.subtotal) };
      });

      sendWhatsAppText(
        { phoneNumberId: storeConfig.whatsapp_phone_number_id, accessToken: storeConfig.whatsapp_access_token },
        cliente.telefono,
        buildReceiptMessage({
          storeName: storeConfig.name,
          numeroComprobante: numero_comprobante,
          clienteNombre: cliente.nombre,
          items: waItems,
          total,
          metodoPago,
        })
      ).catch((e) => console.error("[whatsapp] Error enviando recibo:", e));
    }
  }

  // Email receipt
  if (enviarEmail && clienteId) {
    const { data: clienteParaEmail } = await supabase
      .from("clientes")
      .select("nombre, email, rut")
      .eq("id", clienteId)
      .single();

    if (clienteParaEmail?.email) {
      const { data: itemsParaEmail } = await supabase
        .from("venta_items")
        .select("cantidad, precio_unitario, subtotal, productos(nombre)")
        .eq("venta_id", venta.id as string);

      const montoRestoEmail = pagoNc ? Math.round(total - pagoNc.monto) : 0;
      const pagosEmail: Array<{ metodo: string; monto: number; numero_transaccion?: string }> = pagoNc
        ? [
            { metodo: "nota_credito", monto: pagoNc.monto, numero_transaccion: pagoNc.numero_nc },
            ...(montoRestoEmail > 0
              ? [{ metodo: metodoPago, monto: montoRestoEmail, numero_transaccion: numeroTransaccion ?? undefined }]
              : []),
          ]
        : [{ metodo: metodoPago, monto: total, numero_transaccion: numeroTransaccion ?? undefined }];

      sendBoletaEmail({
        to: clienteParaEmail.email,
        fromEmail: storeConfig?.resend_from_email ?? undefined,
        boleta: {
          numeroComprobante: numero_comprobante,
          fecha: (venta.created_at as string) ?? new Date().toISOString(),
          storeName: storeConfig?.name ?? "Tienda",
          storeRut: storeConfig?.rut ?? undefined,
          cliente: { nombre: clienteParaEmail.nombre, rut: clienteParaEmail.rut ?? undefined },
          items: (itemsParaEmail ?? []).map((i) => ({
            nombre: (i.productos as unknown as { nombre: string } | null)?.nombre ?? "Producto",
            cantidad: i.cantidad,
            precio_unitario: Number(i.precio_unitario),
            subtotal: Number(i.subtotal),
          })),
          subtotal,
          descuentoPct: descuento_pct,
          descuentoMonto: Math.round(descuentoMonto),
          impuesto,
          total,
          pagos: pagosEmail,
        },
      }).catch((e) => console.error("[email] Error enviando boleta:", e));
    }
  }

  // Asiento contable
  const ivaCalc = Math.round(total * IVA_RATE / (1 + IVA_RATE));
  const montoNeto = total - ivaCalc;

  crearAsiento({
    storeId: store_id,
    fecha: (venta.created_at as string)?.split("T")[0] ?? new Date().toISOString().split("T")[0],
    tipoMovimiento: "VENTA",
    canal,
    referenciaId: venta.id as string,
    referenciaNomero: venta.numero_comprobante as string,
    descripcion: `Venta ${canal.toUpperCase()} ${metodoPagoVenta} - ${venta.numero_comprobante}`,
    lineas: pagoNc
      ? lineasVentaConNc({
          montoNeto,
          iva: ivaCalc,
          total,
          montoNc: pagoNc.monto,
          montoResto: Math.round(total - pagoNc.monto),
          metodoPagoResto: metodoPago,
        })
      : lineasVentaCanal({ canal, metodoPago, montoNeto, iva: ivaCalc, total }),
    usuarioId: ctx.userId ?? undefined,
  }).catch((e) => console.error("[contabilidad] Error asiento venta:", e));

  return NextResponse.json(venta);
}
