import type { SupabaseClient } from "@supabase/supabase-js";
import { extraerIva } from "@/lib/tax";
import { crearAsiento, lineasVentaCanal, lineasVentaCOGS } from "@/lib/contabilidad/generador-asientos";
import { syncProductsToHub } from "@/lib/hub-sync";
import { logAudit } from "@/lib/audit";
import type { CanalOrdenItemRow } from "@/types";
import { esCanalExterno, type CanalExternoId, type MotivoRechazo } from "../domain/types";
import { encolarOutbox } from "./outbox";

// procesarOrden (§4.2 pasos a–g, paso 3.2 del plan). Aceptación AUTOMÁTICA
// (D5): la plataforma ya cobró al cliente, así que una orden con stock físico
// suficiente se convierte en venta — aunque deje el producto bajo el mínimo
// (D16: el mínimo es margen de seguridad de los canales, no del stock
// físico). Solo se rechaza si falta el producto o el stock físico.
//
// Idempotente y re-ejecutable (webhook con after(), barrido del cron):
//   - reclamo atómico pending → processing (0 filas = otro proceso la tomó);
//   - crear_venta_tx con idempotency_key por tienda/canal/orden: un
//     reintento tras una caída devuelve la venta ya creada (created=false) y
//     NO repite stock, asientos ni auditoría;
//   - confirmación/rechazo a la plataforma vía outbox con dedupe.
// Debe correr fuera del camino crítico de la respuesta (after() o cron).

export const ORDEN_MAX_INTENTOS = 3;
// Definido en domain/types (lo usan también cancelar-orden y menu sin
// importar este módulo, que depende de la outbox).
export { USUARIO_SISTEMA } from "../domain/types";
import { USUARIO_SISTEMA } from "../domain/types";

export type ResultadoProcesamiento =
  | { resultado: "omitida" }
  | { resultado: "aceptada"; ventaId: string; creada: boolean }
  | { resultado: "rechazada"; motivo: MotivoRechazo; detalle: string }
  | { resultado: "reintentar" | "fallida"; error: string };

interface OrdenReclamada {
  id: string;
  canal_id: string;
  external_order_id: string;
  items: CanalOrdenItemRow[] | null;
  intentos: number;
}

export function idempotencyKeyCanal(storeId: string, canalId: string, externalOrderId: string): string {
  return `canal:${storeId}:${canalId}:${externalOrderId}`;
}

async function reclamar(supabase: SupabaseClient, storeId: string, ordenId: string): Promise<OrdenReclamada | null> {
  const { data: actual } = await supabase
    .from("canal_ordenes")
    .select("intentos")
    .eq("id", ordenId)
    .eq("store_id", storeId)
    .eq("estado", "pending")
    .maybeSingle();
  if (!actual) return null;

  // Reclamo atómico: solo una ejecución concurrente gana la transición.
  const { data } = await supabase
    .from("canal_ordenes")
    .update({ estado: "processing", intentos: Number(actual.intentos ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq("id", ordenId)
    .eq("store_id", storeId)
    .eq("estado", "pending")
    .select("id, canal_id, external_order_id, items, intentos");
  return (data?.[0] as OrdenReclamada | undefined) ?? null;
}

async function rechazar(
  supabase: SupabaseClient,
  storeId: string,
  orden: OrdenReclamada,
  canalId: CanalExternoId,
  motivo: MotivoRechazo,
  detalle: string
): Promise<ResultadoProcesamiento> {
  await supabase
    .from("canal_ordenes")
    .update({
      estado: "rejected",
      rejected_at: new Date().toISOString(),
      motivo_rechazo: `${motivo}: ${detalle}`.slice(0, 500),
      ultimo_error: null,
    })
    .eq("id", orden.id)
    .eq("store_id", storeId)
    .eq("estado", "processing");
  // 3.6: el rechazo se informa a la plataforma por la outbox.
  await encolarOutbox(supabase, {
    storeId,
    canalId,
    tipo: "reject",
    canalOrdenId: orden.id,
    payload: { external_order_id: orden.external_order_id, motivo },
  });
  // 5.4: el rechazo automático también queda auditado (antes solo la venta).
  logAudit({
    storeId,
    userId: USUARIO_SISTEMA,
    action: "UPDATE",
    entityType: "canal_ordenes",
    entityId: orden.id,
    changeDescription: `Pedido ${orden.external_order_id} (${canalId}) rechazado automáticamente: ${motivo}`,
    result: "failure",
  }).catch(() => {});
  return { resultado: "rechazada", motivo, detalle };
}

async function fallar(
  supabase: SupabaseClient,
  storeId: string,
  orden: OrdenReclamada,
  error: string
): Promise<ResultadoProcesamiento> {
  const agotado = orden.intentos >= ORDEN_MAX_INTENTOS;
  await supabase
    .from("canal_ordenes")
    .update({ estado: agotado ? "failed" : "pending", ultimo_error: error.slice(0, 500) })
    .eq("id", orden.id)
    .eq("store_id", storeId)
    .eq("estado", "processing");
  if (agotado) {
    logAudit({
      storeId,
      userId: USUARIO_SISTEMA,
      action: "UPDATE",
      entityType: "canal_ordenes",
      entityId: orden.id,
      changeDescription: `Pedido ${orden.external_order_id} falló tras ${orden.intentos} intentos`,
      result: "failure",
    }).catch(() => {});
  }
  return { resultado: agotado ? "fallida" : "reintentar", error };
}

export async function procesarOrden(
  supabase: SupabaseClient,
  storeId: string,
  ordenId: string
): Promise<ResultadoProcesamiento> {
  const orden = await reclamar(supabase, storeId, ordenId);
  if (!orden) return { resultado: "omitida" };
  if (!esCanalExterno(orden.canal_id)) return fallar(supabase, storeId, orden, "Canal desconocido");
  const canalId: CanalExternoId = orden.canal_id;

  const items = Array.isArray(orden.items) ? orden.items : [];
  if (items.length === 0) return rechazar(supabase, storeId, orden, canalId, "OTHER", "orden sin ítems");

  // b. SKU → producto de ESTA tienda (UNIQUE (store_id, sku), V9). Un SKU
  //    inexistente o inactivo rechaza la orden completa (no se vende menos de
  //    lo que la plataforma cobró).
  const skus = [...new Set(items.map((i) => i.sku))];
  const { data: productos, error: prodError } = await supabase
    .from("productos")
    .select("id, sku, costo, activo")
    .eq("store_id", storeId)
    .in("sku", skus);
  if (prodError) return fallar(supabase, storeId, orden, "Error leyendo productos");

  const porSku = new Map((productos ?? []).filter((p) => p.activo !== false).map((p) => [p.sku as string, p]));
  const faltantes = skus.filter((s) => !porSku.has(s));
  if (faltantes.length > 0) {
    return rechazar(supabase, storeId, orden, canalId, "ITEM_NOT_FOUND", `SKU sin producto activo: ${faltantes.join(", ")}`);
  }

  // c. Venta con el precio que cobró la plataforma (bruto, IVA incluido —
  //    AGENTS.md §23.3; el IVA se EXTRAE del total).
  const pItems = items.map((i) => ({
    producto_id: porSku.get(i.sku)!.id,
    cantidad: i.cantidad,
    precio_unitario: i.precio_unitario_bruto,
    subtotal: i.precio_unitario_bruto * i.cantidad,
    mascota_id: null,
  }));
  const total = pItems.reduce((s, i) => s + i.subtotal, 0);
  const impuesto = extraerIva(total);
  const costoTotal = items.reduce((s, i) => s + i.cantidad * Number(porSku.get(i.sku)!.costo ?? 0), 0);
  const hoy = new Date();
  const numeroComprobante = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}${String(hoy.getDate()).padStart(2, "0")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  const { data: ventaResult, error: txError } = await supabase.rpc("crear_venta_tx", {
    p_store_id: storeId,
    p_items: pItems,
    p_cliente_id: null,
    // ventas.worker_clerk_id tiene FK a clerk_users: la aceptación es
    // automática, no hay cajero.
    p_worker_clerk_id: null,
    p_subtotal: total,
    p_descuento_pct: 0,
    p_impuesto: impuesto,
    p_total: total,
    p_metodo_pago: "plataforma",
    p_canal: canalId,
    // procedencia = canal (migración 073): distingue ventas con conexión
    // sistémica de las registradas a mano en el POS.
    p_procedencia: canalId,
    p_numero_comprobante: numeroComprobante,
    p_pago_nc: null,
    p_numero_transaccion: orden.external_order_id,
    p_fidelizacion_niveles: [],
    p_dias_aviso: 5,
    p_idempotency_key: idempotencyKeyCanal(storeId, canalId, orden.external_order_id),
    p_user_id: null,
  });

  if (txError) {
    const msg = txError.message ?? "";
    if (msg.startsWith("Stock insuficiente")) {
      return rechazar(supabase, storeId, orden, canalId, "ITEM_OUT_OF_STOCK", "sin stock físico suficiente");
    }
    if (txError.code === "23514" && msg.toLowerCase().includes("procedencia")) {
      // Configuración: el canal no está en el CHECK de ventas.procedencia (073).
      console.error(`[canales] '${canalId}' no es una procedencia válida (migración 073)`);
    }
    return fallar(supabase, storeId, orden, `Error creando la venta (${txError.code ?? "?"})`);
  }

  const { venta, created } = ventaResult as {
    venta: { id: string; total: number; numero_comprobante: string; created_at: string };
    created: boolean;
  };

  // d. accepted + venta_id. e. Confirmar a la plataforma (outbox).
  await supabase
    .from("canal_ordenes")
    .update({ estado: "accepted", accepted_at: new Date().toISOString(), venta_id: venta.id, ultimo_error: null })
    .eq("id", orden.id)
    .eq("store_id", storeId)
    .eq("estado", "processing");
  try {
    await encolarOutbox(supabase, {
      storeId,
      canalId,
      tipo: "confirm",
      canalOrdenId: orden.id,
      payload: { external_order_id: orden.external_order_id },
    });
  } catch (e) {
    // La venta ya existe: no se revierte. Queda visible para el admin.
    console.error(`[canales] confirmación no encolada para orden ${orden.id}:`, e);
    await supabase
      .from("canal_ordenes")
      .update({ ultimo_error: "Venta creada pero la confirmación a la plataforma no se pudo encolar" })
      .eq("id", orden.id)
      .eq("store_id", storeId);
  }

  // Reintento idempotente: los efectos secundarios ya ocurrieron en el
  // intento que creó la venta.
  if (!created) return { resultado: "aceptada", ventaId: venta.id, creada: false };

  // f. Auditoría, asientos (ingreso + COGS, igual que el POS) y Hub (C18).
  logAudit({
    storeId,
    userId: USUARIO_SISTEMA,
    action: "CREATE",
    entityType: "venta",
    entityId: venta.id,
    changeDescription: `Venta automática desde orden ${orden.external_order_id} (${canalId})`,
    result: "success",
  }).catch(() => {});

  const fechaVenta = venta.created_at?.split("T")[0] ?? new Date().toISOString().split("T")[0];
  try {
    const asiento1 = await crearAsiento({
      storeId,
      fecha: fechaVenta,
      tipoMovimiento: "VENTA",
      canal: canalId,
      referenciaId: venta.id,
      referenciaNomero: venta.numero_comprobante,
      descripcion: `Venta ${canalId.toUpperCase()} — orden ${orden.external_order_id}`,
      lineas: lineasVentaCanal({ canal: canalId, metodoPago: "plataforma", montoNeto: total - impuesto, iva: impuesto, total }),
    });
    if (!asiento1) console.error(`[contabilidad] Asiento de ingreso NO CREADO para venta ${venta.id} (canal ${canalId})`);
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
      if (!asiento2) console.error(`[contabilidad] Asiento COGS NO CREADO para venta ${venta.id} (canal ${canalId})`);
    }
  } catch (e) {
    console.error("[contabilidad] Error en asiento de venta de canal:", e);
  }

  const { data: actualizados } = await supabase
    .from("productos")
    .select("id, nombre, marca, codigo_barra, precio, stock, activo, tipo_animal, peso_gramos, en_oferta, precio_oferta, imagen_url, categorias(nombre)")
    .eq("store_id", storeId)
    .in("id", pItems.map((i) => i.producto_id));
  if (actualizados && actualizados.length > 0) {
    syncProductsToHub(
      actualizados.map((p) => ({
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

  return { resultado: "aceptada", ventaId: venta.id, creada: true };
}
