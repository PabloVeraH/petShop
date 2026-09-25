import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelAdapter, ChannelContext, ItemCatalogo } from "../adapters/port";
import { precioBase, precioCanal } from "../domain/precio";

// Publicar catálogo (paso 4.5). Solo productos habilitados en el canal y
// activos en la tienda; precio por canal §4.5 (override ?? base × recargo,
// D7/D13/D14). La plataforma recibe el catálogo COMPLETO: lo que no va en él
// deja de estar publicado (publicado_at = NULL) y ya no recibe
// disponibilidad. Tras publicar, el worker encola una disponibilidad
// completa (outbox.ts).

export class CatalogoVacioError extends Error {
  constructor() {
    super("No hay productos habilitados con precio válido para publicar");
    this.name = "CatalogoVacioError";
  }
}

interface ProductoCatalogo {
  id: string;
  store_id: string;
  sku: string;
  nombre: string;
  precio: number | null;
  precio_oferta: number | null;
  en_oferta: boolean | null;
  activo: boolean | null;
  imagen_url: string | null;
  categorias: { nombre: string | null } | null;
}

interface FilaConfigCatalogo {
  producto_id: string;
  precio_override: number | null;
  categoria_canal: string | null;
  descripcion_canal: string | null;
  productos: ProductoCatalogo | null;
}

export interface ItemCatalogoConId extends ItemCatalogo {
  productoId: string;
}

// Arma los ítems a publicar. Omite (y cuenta) los que no tienen precio base
// válido ni override: publicar un precio 0 sería vender gratis.
export function armarCatalogo(
  filas: FilaConfigCatalogo[],
  storeId: string,
  recargoPct: number
): { items: ItemCatalogoConId[]; omitidos: number } {
  const items: ItemCatalogoConId[] = [];
  let omitidos = 0;
  for (const f of filas) {
    const p = f.productos;
    // Defensa de tenant: el producto debe ser de la misma tienda que la config.
    if (!p || p.store_id !== storeId || p.activo === false) continue;
    const override = f.precio_override != null ? Number(f.precio_override) : null;
    const base = precioBase(p);
    if (!(override != null && override > 0) && !(base != null && base > 0)) {
      omitidos++;
      continue;
    }
    items.push({
      productoId: p.id,
      sku: p.sku,
      nombre: p.nombre,
      descripcion: f.descripcion_canal ?? undefined,
      precioBruto: precioCanal(base ?? 0, recargoPct, override),
      categoria: f.categoria_canal ?? p.categorias?.nombre ?? undefined,
      imagenUrl: p.imagen_url,
    });
  }
  return { items, omitidos };
}

export async function publicarCatalogo(
  supabase: SupabaseClient,
  adapter: ChannelAdapter,
  ctx: ChannelContext
): Promise<{ publicados: number; omitidos: number }> {
  const { data, error } = await supabase
    .from("canal_producto_config")
    .select(
      "producto_id, precio_override, categoria_canal, descripcion_canal, productos!inner(id, store_id, sku, nombre, precio, precio_oferta, en_oferta, activo, imagen_url, categorias(nombre))"
    )
    .eq("store_id", ctx.storeId)
    .eq("canal_id", ctx.canalId)
    .eq("activo", true);
  if (error) throw new Error(`No se pudo leer el catálogo: ${error.code ?? error.message}`);

  const { items, omitidos } = armarCatalogo((data ?? []) as unknown as FilaConfigCatalogo[], ctx.storeId, ctx.recargoPct);
  // Un catálogo vacío borraría el menú completo en la plataforma.
  if (items.length === 0) throw new CatalogoVacioError();

  await adapter.pushCatalog(
    ctx,
    items.map((i) => ({
      sku: i.sku,
      nombre: i.nombre,
      descripcion: i.descripcion,
      precioBruto: i.precioBruto,
      categoria: i.categoria,
      imagenUrl: i.imagenUrl,
    }))
  );

  const ids = items.map((i) => i.productoId);
  const ahora = new Date().toISOString();
  const { error: errPub } = await supabase
    .from("canal_producto_config")
    .update({ publicado_at: ahora })
    .eq("store_id", ctx.storeId)
    .eq("canal_id", ctx.canalId)
    .in("producto_id", ids);
  if (errPub) throw new Error(`No se pudo registrar el catálogo publicado: ${errPub.code ?? errPub.message}`);

  const { error: errRetiro } = await supabase
    .from("canal_producto_config")
    .update({ publicado_at: null, ultimo_disponible_publicado: null, ultima_cantidad_publicada: null })
    .eq("store_id", ctx.storeId)
    .eq("canal_id", ctx.canalId)
    .not("producto_id", "in", `(${ids.join(",")})`);
  if (errRetiro) throw new Error(`No se pudo registrar el catálogo publicado: ${errRetiro.code ?? errRetiro.message}`);

  return { publicados: items.length, omitidos };
}
