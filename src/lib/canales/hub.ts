/**
 * Hub de Canales — Lógica de negocio centralizada
 * Manejo de órdenes, stock, contabilidad, devoluciones
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { CanalId, CanalConfig, ChannelError } from "./types";
import { getChannel, isChannelAvailable } from "./registry";
import { extraerIva } from "@/lib/tax";
import { crearAsiento, lineasVentaCanal, lineasVentaCOGS } from "@/lib/contabilidad/generador-asientos";
import { logAudit } from "@/lib/audit";

/**
 * Validar que un canal esté habilitado (ambas capas)
 * Capa 1: ¿está en el registry (ENABLED_CHANNELS)?
 * Capa 2: ¿está habilitado en BD?
 */
export async function assertChannelEnabled(
  canalId: CanalId,
  supabase: SupabaseClient
): Promise<void> {
  // Capa 1: ¿está en el registry?
  if (!isChannelAvailable(canalId)) {
    throw new ChannelError(
      `Canal ${canalId} no disponible en esta instalación`,
      404,
      canalId
    );
  }

  // Capa 2: ¿está habilitado en BD?
  const { data } = await supabase
    .from("canales_externos")
    .select("habilitado")
    .eq("id", canalId)
    .single();

  if (!data?.habilitado) {
    throw new ChannelError(
      `Canal ${canalId} no habilitado`,
      403,
      canalId
    );
  }
}

/**
 * Reservar stock temporalmente entre recepción y aceptación de orden externa
 * Retorna {ok: true} si hay stock disponible, {ok: false, productoFaltante} si no
 */
export async function reservarStock(
  items: Array<{ productoId: string; cantidad: number }>,
  canalOrdenId: string,
  supabase: SupabaseClient
): Promise<{ ok: boolean; productoFaltante?: string }> {
  for (const item of items) {
    // Obtener stock del producto
    const { data: prod } = await supabase
      .from("productos")
      .select("id, stock, nombre")
      .eq("id", item.productoId)
      .single();

    if (!prod) {
      return { ok: false, productoFaltante: `Producto no encontrado` };
    }

    // Calcular stock disponible = stock real - reservado por otras órdenes activas
    const { data: reservas } = await supabase
      .from("stock_reservas")
      .select("cantidad")
      .eq("producto_id", item.productoId)
      .gt("expira_at", new Date().toISOString());

    const totalReservado = reservas?.reduce((s, r) => s + r.cantidad, 0) ?? 0;
    const disponible = (prod?.stock ?? 0) - totalReservado;

    if (disponible < item.cantidad) {
      return { ok: false, productoFaltante: prod?.nombre };
    }

    // Crear reserva
    await supabase.from("stock_reservas").insert({
      producto_id: item.productoId,
      canal_orden_id: canalOrdenId,
      cantidad: item.cantidad,
      expira_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
    });
  }

  return { ok: true };
}

/**
 * Al aceptar la orden: convertir reserva en descuento real de stock
 */
export async function liberarReservaYDescontarStock(
  canalOrdenId: string,
  supabase: SupabaseClient
): Promise<void> {
  const { data: reservas } = await supabase
    .from("stock_reservas")
    .select("producto_id, cantidad")
    .eq("canal_orden_id", canalOrdenId);

  for (const reserva of reservas ?? []) {
    // Descontar stock real
    await supabase.rpc("decrement_stock", {
      p_producto_id: reserva.producto_id,
      p_cantidad: reserva.cantidad,
    });
  }

  // Eliminar reservas (ya fueron descontadas)
  await supabase
    .from("stock_reservas")
    .delete()
    .eq("canal_orden_id", canalOrdenId);
}

/**
 * Al rechazar o expirar: solo liberar reserva sin descontar stock
 */
export async function liberarReservaSinDescontar(
  canalOrdenId: string,
  supabase: SupabaseClient
): Promise<void> {
  await supabase
    .from("stock_reservas")
    .delete()
    .eq("canal_orden_id", canalOrdenId);
}

/**
 * Manejar cancelación post-aceptación
 * 1. Restaurar stock
 * 2. Crear nota de crédito automática
 * 3. Generar asiento contable
 * 4. Marcar venta como anulada
 */
export async function handleCancellation(
  canalOrdenId: string,
  supabase: SupabaseClient
): Promise<void> {
  // Obtener la orden
  const { data: orden } = await supabase
    .from("canal_ordenes")
    .select("*, venta_id, store_id, canal_id")
    .eq("id", canalOrdenId)
    .single();

  if (!orden) {
    throw new ChannelError("Orden no encontrada");
  }

  // Marcar orden como cancelada
  await supabase
    .from("canal_ordenes")
    .update({ estado: "cancelled" })
    .eq("id", canalOrdenId);

  if (orden.venta_id) {
    // La venta ya fue creada: restaurar stock y crear NC
    const { data: venta } = await supabase
      .from("ventas")
      .select("id, total, store_id")
      .eq("id", orden.venta_id)
      .single();

    if (venta) {
      // Restaurar stock
      const { data: items } = await supabase
        .from("venta_items")
        .select("producto_id, cantidad")
        .eq("venta_id", orden.venta_id);

      for (const item of items ?? []) {
        await supabase.rpc("increment_stock", {
          p_producto_id: item.producto_id,
          p_cantidad: item.cantidad,
        });
      }

      // TODO: Crear nota de crédito automática
      // TODO: Generar asiento contable de devolución

      // Marcar venta como anulada
      await supabase
        .from("ventas")
        .update({ estado: "anulada" })
        .eq("id", orden.venta_id);
    }
  } else {
    // La venta no fue creada: solo liberar reserva
    await liberarReservaSinDescontar(canalOrdenId, supabase);
  }
}

/**
 * Obtener configuración de un canal para una tienda
 */
export async function getCanalConfig(
  storeId: string,
  canalId: CanalId,
  supabase: SupabaseClient
) {
  const { data, error } = await supabase
    .from("canal_config")
    .select("*")
    .eq("store_id", storeId)
    .eq("canal_id", canalId)
    .single();

  if (error) {
    throw new ChannelError(
      `No se encontró configuración para canal ${canalId}`,
      404,
      canalId
    );
  }

  return data;
}

/**
 * Listar órdenes activas (pending/reserved) de un canal
 */
export async function getActiveOrders(
  storeId: string,
  canalId: CanalId,
  supabase: SupabaseClient
) {
  const { data, error } = await supabase
    .from("canal_ordenes")
    .select("*")
    .eq("store_id", storeId)
    .eq("canal_id", canalId)
    .in("estado", ["pending", "reserved", "accepted"])
    .order("created_at", { ascending: false });

  if (error) {
    throw new ChannelError(`Error obteniendo órdenes: ${error.message}`);
  }

  return data;
}

// ============================================================
// Aceptación de orden externa — pipeline canónico de venta
// ============================================================

export type AceptarOrdenResult =
  | { ok: true; ventaId: string; total: number; created: boolean }
  | { ok: false; status: number; error: string };

interface CanalOrdenItemRaw {
  id: string;        // SKU externo (mapeado 1:1 con productos.sku)
  quantity: number;
  unit_price: number; // bruto, IVA incluido — misma regla que POS (ver src/lib/tax.ts)
}

/**
 * Acepta una orden de un canal externo (Rappi/PedidosYa/UberEats/futuros
 * canales como Shopify) y la convierte en una venta real.
 *
 * A diferencia de la versión anterior (que insertaba `ventas`/`venta_items`
 * directamente), esta función delega TODO el efecto transaccional a
 * `crear_venta_tx` — el mismo RPC que usa el POS — para que una venta de
 * canal obtenga las mismas garantías: descuento de stock FIFO por lotes,
 * registro en `stock_movements`, idempotencia por `idempotency_key`, y
 * atomicidad (si un paso falla, PostgreSQL hace ROLLBACK de todo).
 *
 * También genera el asiento contable de la venta (`lineasVentaCanal`, que ya
 * distingue la cuenta por cobrar según el canal) y su COGS, igual que hace
 * POST /api/ventas — antes de este fix, ninguna venta de canal externo
 * quedaba reflejada en el Libro Diario.
 */
export async function aceptarOrdenExterna(
  ordenId: string,
  storeId: string,
  userId: string,
  supabase: SupabaseClient,
  metadata?: { ipAddress?: string | null; userAgent?: string | null }
): Promise<AceptarOrdenResult> {
  const { data: orden, error: ordenError } = await supabase
    .from("canal_ordenes")
    .select("id, canal_id, external_order_id, estado, payload")
    .eq("id", ordenId)
    .eq("store_id", storeId)
    .single();

  if (ordenError || !orden) {
    return { ok: false, status: 404, error: "Orden no encontrada" };
  }

  if (orden.estado !== "pending" && orden.estado !== "reserved") {
    return { ok: false, status: 400, error: "La orden ya fue procesada" };
  }

  const canalId = orden.canal_id as CanalId;
  const rawPayload = orden.payload as { items?: CanalOrdenItemRaw[] } | null;
  const items = rawPayload?.items ?? [];

  if (items.length === 0) {
    return { ok: false, status: 400, error: "Orden sin items" };
  }

  // Resolver SKU → producto interno. A diferencia de la versión anterior,
  // un SKU no encontrado ahora aborta toda la aceptación en vez de crear una
  // venta con menos items de los que el total cobrado por el canal implica.
  const skus = [...new Set(items.map((i) => i.id))];
  const { data: productosDB, error: productosError } = await supabase
    .from("productos")
    .select("id, sku, stock, costo")
    .eq("store_id", storeId)
    .in("sku", skus);

  if (productosError) {
    return { ok: false, status: 500, error: "Error interno del servidor" };
  }

  const productoPorSku = new Map<string, { id: string; stock: number; costo: number }>();
  const skusDuplicados: string[] = [];
  for (const p of productosDB ?? []) {
    if (productoPorSku.has(p.sku)) {
      skusDuplicados.push(p.sku);
      continue;
    }
    productoPorSku.set(p.sku, { id: p.id, stock: p.stock, costo: Number(p.costo ?? 0) });
  }

  const skusFaltantes = skus.filter((sku) => !productoPorSku.has(sku));
  if (skusFaltantes.length > 0) {
    return {
      ok: false,
      status: 422,
      error: `Producto(s) no encontrados para SKU: ${skusFaltantes.join(", ")}`,
    };
  }
  if (skusDuplicados.length > 0) {
    // Integridad de catálogo — mismo SKU repetido en dos productos de la tienda.
    return {
      ok: false,
      status: 500,
      error: `Error de integridad de catálogo: SKU duplicado (${skusDuplicados.join(", ")})`,
    };
  }

  // Consolidar cantidades por SKU (el payload externo puede traer líneas repetidas)
  const cantidadPorSku = new Map<string, number>();
  for (const item of items) {
    cantidadPorSku.set(item.id, (cantidadPorSku.get(item.id) ?? 0) + item.quantity);
  }

  const stockErrors: string[] = [];
  for (const [sku, cantidad] of cantidadPorSku) {
    const prod = productoPorSku.get(sku)!;
    if (cantidad > prod.stock) {
      stockErrors.push(`SKU ${sku}: disponible ${prod.stock}, solicitado ${cantidad}`);
    }
  }
  if (stockErrors.length > 0) {
    return { ok: false, status: 422, error: `Stock insuficiente — ${stockErrors.join("; ")}` };
  }

  const pItems = items.map((item) => {
    const prod = productoPorSku.get(item.id)!;
    return {
      producto_id: prod.id,
      cantidad: item.quantity,
      precio_unitario: item.unit_price,
      subtotal: item.unit_price * item.quantity,
      mascota_id: null,
    };
  });

  const total = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  const impuesto = extraerIva(total);
  const costoTotal = Array.from(cantidadPorSku.entries()).reduce(
    (sum, [sku, cantidad]) => sum + cantidad * (productoPorSku.get(sku)?.costo ?? 0),
    0
  );

  const hoy = new Date();
  const numeroComprobante = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}${String(hoy.getDate()).padStart(2, "0")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  // Idempotencia: reintentos del mismo accept (doble clic del operador, retry
  // de red, o dos requests concurrentes) comparten esta key — crear_venta_tx
  // devuelve la venta ya creada en vez de repetir stock/pagos/fidelización.
  const idempotencyKey = `canal:${canalId}:${orden.external_order_id}`;

  // procedencia = canalId: a diferencia de whatsapp/instagram/facebook/tiktok/
  // telefonico (canales sin integración de API real en Chile, que el cajero
  // registra a mano en el POS), rappi/pedidosya/ubereats SÍ tienen conexión
  // sistémica — se distinguen de 'presencial' para poder reportarlos. El
  // desplegable del POS (PROCEDENCIAS en ModalPago.tsx) y el schema Zod de
  // POST /api/ventas siguen sin estos valores: no son opciones del cajero,
  // solo esta función los escribe. Requiere migrations/073 (CHECK constraint
  // de ventas.procedencia) — un canal nuevo con conexión real (ej. Shopify)
  // necesita la misma extensión antes de poder aceptar su primera orden.
  const { data: ventaResult, error: txError } = await supabase.rpc("crear_venta_tx", {
    p_store_id: storeId,
    p_items: pItems,
    p_cliente_id: null,
    p_worker_clerk_id: userId,
    p_subtotal: total,
    p_descuento_pct: 0,
    p_impuesto: impuesto,
    p_total: total,
    p_metodo_pago: "plataforma",
    p_canal: canalId,
    p_procedencia: canalId,
    p_numero_comprobante: numeroComprobante,
    p_pago_nc: null,
    p_numero_transaccion: orden.external_order_id,
    p_fidelizacion_niveles: [],
    p_dias_aviso: 5,
    p_idempotency_key: idempotencyKey,
  });

  if (txError) {
    const isStockError =
      txError.message.toLowerCase().includes("stock") ||
      txError.message.toLowerCase().includes("insuficiente");
    // 23514 = check_violation. La causa más probable acá es que canalId
    // todavía no está en el CHECK constraint de ventas.procedencia (ver
    // migrations/073) — típico al conectar un canal nuevo sin actualizar esa
    // migración. Se loguea explícito para no confundirlo con un 500 genérico.
    const isProcedenciaCheckViolation =
      txError.code === "23514" && txError.message.toLowerCase().includes("procedencia");
    if (isProcedenciaCheckViolation) {
      console.error(
        `[canales] Canal '${canalId}' no está habilitado como procedencia válida — falta agregarlo al CHECK constraint de ventas.procedencia (ver migrations/073).`
      );
    }
    return {
      ok: false,
      status: isStockError ? 422 : 500,
      error: isStockError ? "Stock insuficiente para completar la venta." : "Error interno del servidor",
    };
  }

  const { venta, created } = ventaResult as {
    venta: { id: string; total: number; numero_comprobante: string; created_at: string };
    created: boolean;
  };

  // Reintento idempotente: la venta ya existía de un intento anterior — no
  // repetir liberación de reserva, confirmación al canal, auditoría ni asientos.
  if (!created) {
    return { ok: true, ventaId: venta.id, total: venta.total, created: false };
  }

  // La reserva temporal (si existía) ya cumplió su función — el stock real ya
  // fue descontado dentro de crear_venta_tx. Liberarla es un no-op seguro si
  // nunca se creó (los canales actuales aún no llaman reservarStock en el
  // webhook de intake).
  await liberarReservaSinDescontar(ordenId, supabase);

  await supabase
    .from("canal_ordenes")
    .update({
      estado: "accepted",
      accepted_at: new Date().toISOString(),
      venta_id: venta.id,
    })
    .eq("id", ordenId);

  try {
    const channel = getChannel(canalId);
    const config: CanalConfig = {
      storeId,
      canalId,
      externalStoreId: "",
      credentials: {},
      comisionPct: 0,
    };
    await channel.confirmOrder(config, orden.external_order_id);
  } catch (e) {
    console.error("[canales] Error confirmando al canal:", e);
  }

  await logAudit({
    storeId,
    userId,
    action: "CREATE",
    entityType: "venta",
    entityId: venta.id,
    changeDescription: `Venta creada desde orden ${orden.external_order_id} (${canalId})`,
    ipAddress: metadata?.ipAddress,
    userAgent: metadata?.userAgent,
    result: "success",
  });

  // Asiento contable (post-respuesta): after() de next/server garantiza que
  // la plataforma espere el callback tras responder — mismo patrón que
  // POST /api/ventas, necesario en serverless para que el fire-and-forget no
  // quede congelado a mitad de ejecución entre el asiento de ingreso y el COGS.
  const montoNeto = total - impuesto;
  const fechaVenta = venta.created_at?.split("T")[0] ?? new Date().toISOString().split("T")[0];
  after(async () => {
    try {
      const asiento1 = await crearAsiento({
        storeId,
        fecha: fechaVenta,
        tipoMovimiento: "VENTA",
        canal: canalId,
        referenciaId: venta.id,
        referenciaNomero: venta.numero_comprobante,
        descripcion: `Venta ${canalId.toUpperCase()} — orden ${orden.external_order_id}`,
        lineas: lineasVentaCanal({ canal: canalId, metodoPago: "plataforma", montoNeto, iva: impuesto, total }),
      });
      if (!asiento1) {
        console.error(`[contabilidad] Asiento de ingreso NO CREADO para venta ${venta.id} (canal ${canalId})`);
      }

      if (costoTotal > 0) {
        const asiento2 = await crearAsiento({
          storeId,
          fecha: fechaVenta,
          tipoMovimiento: "VENTA",
          canal: canalId,
          referenciaId: venta.id,
          referenciaNomero: venta.numero_comprobante,
          descripcion: `COGS venta ${canalId.toUpperCase()} — costo mercancía`,
          lineas: lineasVentaCOGS(Math.round(costoTotal)),
        });
        if (!asiento2) {
          console.error(`[contabilidad] Asiento COGS NO CREADO para venta ${venta.id} (canal ${canalId})`);
        }
      }
    } catch (e) {
      console.error("[contabilidad] Error en asiento de venta de canal:", e);
    }
  });

  return { ok: true, ventaId: venta.id, total: venta.total, created: true };
}
