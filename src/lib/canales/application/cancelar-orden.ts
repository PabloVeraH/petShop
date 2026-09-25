import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import { anularVenta } from "@/lib/ventas/anular-venta";
import type { CanalExternoId } from "../domain/types";
import { USUARIO_SISTEMA } from "./procesar-orden";

// Cancelación desde la plataforma (paso 3.5, resuelve C10: antes solo se
// marcaba 'cancelled' y la venta seguía activa, con stock descontado y
// asiento vigente).
//   pending            → cancelled, sin venta
//   processing         → en_proceso: el webhook responde 503 para que la
//                        plataforma reintente cuando termine el procesamiento
//   accepted / ready   → anularVenta() (anular_venta_tx, §23.5: stock,
//                        fidelización y contra-asientos) + cancelled; los
//                        trabajos de outbox vivos de la orden se descartan
//   picked_up/delivered→ no se anula automáticamente (ya salió de la tienda)
//   terminales / inexistente → ignorada (idempotente ante reentregas)
// Debe llamarse dentro del scope de un request (anularVenta usa after()).

export type ResultadoCancelacion =
  | { resultado: "cancelada" | "anulada" | "ignorada" | "en_proceso" }
  | { resultado: "error"; error: string };

export async function cancelarOrdenCanal(
  supabase: SupabaseClient,
  storeId: string,
  canalId: CanalExternoId,
  externalOrderId: string,
  motivo?: string
): Promise<ResultadoCancelacion> {
  const { data: orden } = await supabase
    .from("canal_ordenes")
    .select("id, estado, venta_id")
    .eq("store_id", storeId)
    .eq("canal_id", canalId)
    .eq("external_order_id", externalOrderId)
    .maybeSingle();
  if (!orden) return { resultado: "ignorada" };

  if (orden.estado === "pending") {
    const { data } = await supabase
      .from("canal_ordenes")
      .update({ estado: "cancelled", ultimo_error: motivo ? `Cancelada por la plataforma: ${motivo}` : null })
      .eq("id", orden.id)
      .eq("store_id", storeId)
      .eq("estado", "pending")
      .select("id");
    // 0 filas: otro proceso la reclamó entre la lectura y el UPDATE.
    return data && data.length > 0 ? { resultado: "cancelada" } : { resultado: "en_proceso" };
  }

  if (orden.estado === "processing") return { resultado: "en_proceso" };

  if (orden.estado === "accepted" || orden.estado === "ready") {
    if (orden.venta_id) {
      const r = await anularVenta(supabase, storeId, orden.venta_id, null);
      // 409 = ya estaba anulada (reentrega de la cancelación): se sigue.
      if (!r.ok && r.status !== 409) return { resultado: "error", error: r.error };
    }
    await supabase
      .from("canal_ordenes")
      .update({ estado: "cancelled", ultimo_error: motivo ? `Cancelada por la plataforma: ${motivo}` : null })
      .eq("id", orden.id)
      .eq("store_id", storeId)
      .in("estado", ["accepted", "ready"]);
    // Confirmar / "lista para retiro" de una orden cancelada ya no aplica.
    await supabase
      .from("canal_outbox")
      .update({ estado: "done", processed_at: new Date().toISOString(), last_error: "Omitido: orden cancelada por la plataforma" })
      .eq("canal_orden_id", orden.id)
      .eq("store_id", storeId)
      .eq("estado", "pending");
    logAudit({
      storeId,
      userId: USUARIO_SISTEMA,
      action: "UPDATE",
      entityType: "canal_ordenes",
      entityId: orden.id,
      changeDescription: `Orden ${externalOrderId} (${canalId}) cancelada por la plataforma; venta ${orden.venta_id ?? "—"} anulada`,
      result: "success",
    }).catch(() => {});
    return { resultado: "anulada" };
  }

  if (orden.estado === "picked_up" || orden.estado === "delivered") {
    console.warn(`[canales] cancelación de la orden ${orden.id} en estado ${orden.estado}: no se anula automáticamente`);
  }
  return { resultado: "ignorada" };
}
