import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanalExternoId, MotivoRechazo } from "../domain/types";
import { esCanalExterno } from "../domain/types";
import { obtenerAdaptador } from "../adapters/registry";
import { PlataformaError } from "../adapters/port";
import { CanalNoConfiguradoError, CredencialesInvalidasError, loadChannelContext } from "../infrastructure/context";
import { publicarDisponibilidad } from "./disponibilidad";
import { CatalogoVacioError, publicarCatalogo } from "./catalogo";

// Outbox de canales (§5.3, paso 3.4). Toda llamada saliente a una plataforma
// (confirmar, rechazar, lista para retiro) se ENCOLA y la ejecuta el worker:
// nunca fire-and-forget (C11 — antes el error de confirmar se tragaba con un
// console.error y no había reintento). Fase 4: también la publicación de
// catálogo y de disponibilidad.

export type TipoOutboxOrden = "confirm" | "reject" | "ready";
export type TipoOutboxTienda = "availability" | "catalog";

export const OUTBOX_MAX_INTENTOS = 8;

// Backoff exponencial: 1, 2, 4, 8, 16, 32, 60, 60 minutos.
export function proximoIntentoMs(intentos: number, ahoraMs = Date.now()): number {
  const minutos = Math.min(60, 2 ** Math.max(0, intentos - 1));
  return ahoraMs + minutos * 60_000;
}

export async function encolarOutbox(
  supabase: SupabaseClient,
  job: {
    storeId: string;
    canalId: CanalExternoId;
    tipo: TipoOutboxOrden;
    canalOrdenId: string;
    payload: Record<string, unknown>;
  }
): Promise<void> {
  // dedupe_key por orden y tipo: reintentos del procesamiento o doble clic en
  // "Marcar lista" no duplican la llamada mientras la anterior siga viva
  // (índice único parcial canal_outbox_dedupe_vivo, migración 079).
  const { error } = await supabase.from("canal_outbox").insert({
    store_id: job.storeId,
    canal_id: job.canalId,
    tipo: job.tipo,
    canal_orden_id: job.canalOrdenId,
    payload: job.payload,
    dedupe_key: `${job.tipo}:${job.canalOrdenId}`,
  });
  // 23505 = ya hay un trabajo vivo igual → idempotente, no es error.
  if (error && error.code !== "23505") {
    throw new Error(`No se pudo encolar ${job.tipo} de la orden ${job.canalOrdenId}: ${error.code ?? error.message}`);
  }
}

// Trabajos de tienda (no de una orden). dedupe_key explícita:
//   catalog:{store}:{canal}      — un "Publicar catálogo" vivo a la vez
//   avail-full:{store}:{canal}   — disponibilidad completa (tras publicar el
//                                  catálogo y en la reconciliación diaria)
//   avail:{store}:{canal}        — la encola el trigger de la migración 082
// Devuelve false si ya había uno vivo igual (coalescencia, no es error).
export async function encolarTrabajoTienda(
  supabase: SupabaseClient,
  job: {
    storeId: string;
    canalId: CanalExternoId;
    tipo: TipoOutboxTienda;
    payload: Record<string, unknown>;
    dedupeKey: string;
  }
): Promise<boolean> {
  const { error } = await supabase.from("canal_outbox").insert({
    store_id: job.storeId,
    canal_id: job.canalId,
    tipo: job.tipo,
    payload: job.payload,
    dedupe_key: job.dedupeKey,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`No se pudo encolar ${job.tipo} de la tienda: ${error.code ?? error.message}`);
}

export function claveDisponibilidadCompleta(storeId: string, canalId: CanalExternoId): string {
  return `avail-full:${storeId}:${canalId}`;
}

interface FilaOutbox {
  id: string;
  store_id: string;
  canal_id: string;
  tipo: string;
  canal_orden_id: string | null;
  payload: Record<string, unknown> | null;
  intentos: number;
}

export interface ResultadoOutbox {
  reclamados: number;
  hechos: number;
  reintentos: number;
  muertos: number;
}

// Mensaje de error apto para guardar (sin secretos: los adaptadores no
// incluyen credenciales ni cuerpos de respuesta en sus errores).
function mensajeError(e: unknown): string {
  if (
    e instanceof PlataformaError ||
    e instanceof CredencialesInvalidasError ||
    e instanceof CanalNoConfiguradoError ||
    e instanceof CatalogoVacioError
  ) {
    return e.message;
  }
  return e instanceof Error ? e.name : "Error desconocido";
}

async function despachar(supabase: SupabaseClient, fila: FilaOutbox): Promise<void> {
  if (!esCanalExterno(fila.canal_id)) throw new Error("Canal desconocido");
  const adapter = obtenerAdaptador(fila.canal_id);
  if (!adapter) throw new CanalNoConfiguradoError();
  const ctx = await loadChannelContext(supabase, fila.store_id, fila.canal_id, adapter);
  const externalOrderId = String(fila.payload?.external_order_id ?? "");
  if (!externalOrderId && fila.tipo !== "availability" && fila.tipo !== "catalog") {
    throw new Error("Trabajo sin external_order_id");
  }

  switch (fila.tipo) {
    case "confirm":
      return adapter.confirmOrder(ctx, externalOrderId);
    case "reject":
      return adapter.rejectOrder(ctx, externalOrderId, (fila.payload?.motivo as MotivoRechazo) ?? "OTHER");
    case "ready":
      return adapter.markReady(ctx, externalOrderId);
    case "availability":
      await publicarDisponibilidad(supabase, adapter, ctx, fila.payload?.completo === true);
      return;
    case "catalog":
      await publicarCatalogo(supabase, adapter, ctx);
      // §4.5: después del catálogo, disponibilidad completa (la plataforma
      // recién conoce los productos; sin esto quedarían con su estado por
      // defecto hasta el próximo cambio de stock).
      await encolarTrabajoTienda(supabase, {
        storeId: fila.store_id,
        canalId: fila.canal_id,
        tipo: "availability",
        payload: { completo: true },
        dedupeKey: claveDisponibilidadCompleta(fila.store_id, fila.canal_id),
      });
      return;
    default:
      throw new Error(`Tipo de trabajo desconocido: ${fila.tipo}`);
  }
}

// Un cambio de stock ocurrido MIENTRAS se procesaba un trabajo de
// disponibilidad no pudo encolarse (el trabajo seguía vivo y la dedupe_key lo
// coalesció). Al terminar, se vuelve a comparar el estado actual con lo
// publicado. Si falla, lo corrige la reconciliación diaria (4.6).
async function reencolarDisponibilidadSiCambio(supabase: SupabaseClient, fila: FilaOutbox): Promise<void> {
  const { error } = await supabase.rpc("encolar_disponibilidad_canal", {
    p_store_id: fila.store_id,
    p_canal_id: fila.canal_id,
  });
  if (error) console.error(`[canales/outbox] no se pudo re-verificar la disponibilidad (${error.code ?? "error"})`);
}

// Worker: reclama un lote (FOR UPDATE SKIP LOCKED en claim_canal_outbox,
// migración 080) y ejecuta cada trabajo. Éxito → done; error → pending con
// backoff; agotados los intentos → dead (requiere atención, Fase 5.3).
export async function procesarOutbox(supabase: SupabaseClient, limite = 20): Promise<ResultadoOutbox> {
  const { data, error } = await supabase.rpc("claim_canal_outbox", { p_limit: limite });
  if (error) throw new Error(`No se pudo reclamar la outbox: ${error.code ?? error.message}`);

  const filas = (data ?? []) as FilaOutbox[];
  const resultado: ResultadoOutbox = { reclamados: filas.length, hechos: 0, reintentos: 0, muertos: 0 };

  for (const fila of filas) {
    try {
      await despachar(supabase, fila);
      await supabase
        .from("canal_outbox")
        .update({ estado: "done", processed_at: new Date().toISOString(), last_error: null })
        .eq("id", fila.id)
        .eq("estado", "processing");
      resultado.hechos++;
      if (fila.tipo === "availability") await reencolarDisponibilidadSiCambio(supabase, fila);
    } catch (e) {
      // Un catálogo vacío no se arregla reintentando: requiere que el admin
      // habilite productos y vuelva a publicar.
      const muerto = fila.intentos >= OUTBOX_MAX_INTENTOS || e instanceof CatalogoVacioError;
      await supabase
        .from("canal_outbox")
        .update({
          estado: muerto ? "dead" : "pending",
          last_error: mensajeError(e),
          next_attempt_at: new Date(proximoIntentoMs(fila.intentos)).toISOString(),
        })
        .eq("id", fila.id)
        .eq("estado", "processing");
      if (muerto) {
        resultado.muertos++;
        console.error(`[canales/outbox] trabajo ${fila.tipo} ${fila.id} muerto tras ${fila.intentos} intentos`);
      } else {
        resultado.reintentos++;
      }
    }
  }
  return resultado;
}
