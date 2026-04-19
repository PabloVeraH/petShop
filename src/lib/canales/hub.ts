/**
 * Hub de Canales — Lógica de negocio centralizada
 * Manejo de órdenes, stock, contabilidad, devoluciones
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { CanalId, ChannelError } from "./types";
import { getChannel, isChannelAvailable } from "./registry";

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
