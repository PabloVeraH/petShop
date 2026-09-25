import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelAdapter, ChannelContext, ItemDisponibilidad } from "../adapters/port";

// Disponibilidad hacia las plataformas (D4, §4.4, paso 4.2). El trigger de la
// migración 082 solo ENCOLA un trabajo por tienda/canal; este worker lee el
// estado ACTUAL al procesar (level-triggered): un stock que sube y baja diez
// veces antes de procesarse genera una sola llamada con el estado final.
// Fuente única del estado: la función SQL estado_disponibilidad_canal
// (licencia D15, producto activo, habilitado en canal, canal activo, cupo D4).

export interface FilaEstadoDisponibilidad {
  producto_id: string;
  sku: string;
  disponible: boolean;
  cupo: number;
  ultimo_disponible_publicado: boolean | null;
  ultima_cantidad_publicada: number | null;
}

export type ModoDisponibilidad = "toggle" | "quantity";

// Qué hay que enviar: todo (reconciliación / tras publicar el catálogo) o
// solo lo que difiere de lo último publicado. En modo "quantity" también
// cuenta un cambio de cupo aunque siga disponible.
export function itemsAPublicar(
  filas: FilaEstadoDisponibilidad[],
  modo: ModoDisponibilidad,
  completo: boolean
): ItemDisponibilidad[] {
  return filas
    .filter(
      (f) =>
        completo ||
        f.disponible !== f.ultimo_disponible_publicado ||
        (modo === "quantity" && Number(f.cupo) !== f.ultima_cantidad_publicada)
    )
    .map((f) => ({
      sku: f.sku,
      disponible: f.disponible,
      ...(modo === "quantity" ? { cantidad: f.disponible ? Number(f.cupo) : 0 } : {}),
    }));
}

export async function publicarDisponibilidad(
  supabase: SupabaseClient,
  adapter: ChannelAdapter,
  ctx: ChannelContext,
  completo: boolean
): Promise<number> {
  const { data, error } = await supabase.rpc("estado_disponibilidad_canal", {
    p_store_id: ctx.storeId,
    p_canal_id: ctx.canalId,
  });
  if (error) throw new Error(`No se pudo leer la disponibilidad: ${error.code ?? error.message}`);

  const filas = (data ?? []) as FilaEstadoDisponibilidad[];
  const modo = adapter.capabilities.availabilityMode;
  const items = itemsAPublicar(filas, modo, completo);
  if (items.length === 0) return 0;

  await adapter.pushAvailability(ctx, items);

  // Registrar lo publicado (lo que compara el trigger para decidir si hay
  // que volver a encolar). Un fallo aquí no deshace la llamada ya hecha: el
  // trabajo se reintenta y republica el mismo estado (idempotente).
  const porSku = new Map(filas.map((f) => [f.sku, f]));
  const ahora = new Date().toISOString();
  const grupos = new Map<string, { disponible: boolean; cantidad: number | null; ids: string[] }>();
  for (const it of items) {
    const fila = porSku.get(it.sku);
    if (!fila) continue;
    const cantidad = modo === "quantity" ? (it.cantidad ?? 0) : null;
    const clave = `${it.disponible}:${cantidad}`;
    const g = grupos.get(clave) ?? { disponible: it.disponible, cantidad, ids: [] };
    g.ids.push(fila.producto_id);
    grupos.set(clave, g);
  }
  for (const g of grupos.values()) {
    const { error: errUpd } = await supabase
      .from("canal_producto_config")
      .update({
        ultimo_disponible_publicado: g.disponible,
        ultima_cantidad_publicada: g.cantidad,
        disponibilidad_publicada_at: ahora,
      })
      .eq("store_id", ctx.storeId)
      .eq("canal_id", ctx.canalId)
      .in("producto_id", g.ids);
    if (errUpd) throw new Error(`No se pudo registrar la disponibilidad publicada: ${errUpd.code ?? errUpd.message}`);
  }
  return items.length;
}
