import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import type { CanalMenuEstado } from "@/types";
import { USUARIO_SISTEMA, type CanalExternoId } from "../domain/types";

// Estado del catálogo en la plataforma (Fase 5, 5.3 — migración 083):
//   enviado    → publicarCatalogo terminó (la plataforma lo revisa)
//   aprobado   → evento MENU_APPROVED
//   rechazado  → evento MENU_REJECTED (alerta para el admin)
// No lanza: un fallo al registrarlo no debe hacer fallar el webhook ni el
// trabajo de catálogo (la plataforma reintentaría un evento ya aceptado).
const MAX_DETALLE = 500;

export async function registrarEstadoMenu(
  supabase: SupabaseClient,
  storeId: string,
  canalId: CanalExternoId,
  estado: CanalMenuEstado,
  detalle?: string
): Promise<void> {
  const { data, error } = await supabase
    .from("canal_config")
    .update({
      menu_estado: estado,
      menu_detalle: estado === "rechazado" ? (detalle ?? "").slice(0, MAX_DETALLE) || null : null,
      menu_estado_at: new Date().toISOString(),
    })
    .eq("store_id", storeId)
    .eq("canal_id", canalId)
    .select("id");
  if (error) {
    console.error(`[canales/menu] no se pudo registrar el estado ${estado} (${error.code ?? "error"})`);
    return;
  }
  const configId = (data as { id: string }[] | null)?.[0]?.id;
  if (estado === "rechazado" && configId) {
    logAudit({
      storeId,
      userId: USUARIO_SISTEMA,
      action: "UPDATE",
      entityType: "canal_catalog",
      entityId: configId, // audit_logs.entity_id es UUID
      changeDescription: `Menú rechazado por ${canalId}${detalle ? `: ${detalle.slice(0, 200)}` : ""}`,
      result: "failure",
    }).catch(() => {});
  }
}
