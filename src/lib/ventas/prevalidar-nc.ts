import type { SupabaseClient } from "@supabase/supabase-js";
import { hoyNegocioISO } from "@/lib/dates";

export type ResultadoPrevalidacionNc =
  | { ok: true; numeroNc: string }
  | { ok: false; status: 400 | 404 | 409 | 410; error: string };

// Pre-validación de la nota de crédito usada como pago, antes de abrir la
// transacción: da mensajes claros al cajero. NO es la autoridad: aplicar_pagos
// (migración 093) repite cada regla con la NC bloqueada (FOR UPDATE), así que
// una carrera entre esta lectura y el cobro termina en 409 desde la RPC.
// Compartida por POST /api/ventas y PATCH /api/citas/[id] (antes duplicada).
export async function prevalidarNotaCredito(
  supabase: SupabaseClient,
  storeId: string,
  notaCreditoId: string,
  monto: number,
  clienteId: string | null | undefined
): Promise<ResultadoPrevalidacionNc> {
  const { data: nc } = await supabase
    .from("notas_credito")
    .select("id, numero_nc, monto_total, fecha_vencimiento, estado, tipo_reembolso, cliente_id")
    .eq("id", notaCreditoId)
    .eq("store_id", storeId)
    .single();

  if (!nc) return { ok: false, status: 404, error: "Nota de crédito no encontrada" };
  // Reembolso directo: el dinero ya se devolvió al cliente (decisión D7).
  if (nc.tipo_reembolso !== "saldo_a_favor") {
    return { ok: false, status: 409, error: "Esta nota de crédito ya se reembolsó directamente al cliente y no se puede usar como pago" };
  }
  if (nc.estado !== "activa") return { ok: false, status: 409, error: "NC ya fue utilizada o está inactiva" };
  if (nc.fecha_vencimiento && nc.fecha_vencimiento < hoyNegocioISO()) {
    return { ok: false, status: 410, error: "NC vencida" };
  }
  // Solo el dueño de la NC la usa (decisión 2026-11-12).
  if (!nc.cliente_id) {
    return { ok: false, status: 409, error: "Esta nota de crédito no tiene cliente asignado: asígnele su dueño antes de usarla" };
  }
  if (nc.cliente_id !== clienteId) {
    return { ok: false, status: 409, error: "La nota de crédito pertenece a otro cliente" };
  }
  if (monto > Number(nc.monto_total)) return { ok: false, status: 400, error: "Monto NC no coincide" };
  return { ok: true, numeroNc: nc.numero_nc as string };
}
