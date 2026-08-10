import { NextRequest, NextResponse } from "next/server";
import { createHash }                from "crypto";
import { getStoreId }                from "@/lib/auth";
import { createServiceClient }       from "@/lib/supabase";
import { obtenerContextoClimatico, SANTIAGO_LAT, SANTIAGO_LON } from "@/lib/weather";
import { recomendarProductosEnPOS }  from "@/lib/openrouter";
import { POSRecomendadorRequestSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";

// Mismo mecanismo de cold-start que /api/ai/vencimientos/optimizar (ver ese
// route.ts): recomendarProductosEnPOS tiene su propio timeout interno de 20s
// (lib/openrouter.ts). Sin maxDuration explícito, esta ruta dependía del
// límite implícito de la plataforma en vez de garantizar que el timeout
// interno complete antes de que la plataforma mate la función y sirva HTML
// en vez de JSON — la causa raíz original de este bug. No tiene reintento
// (a diferencia de vencimientos): es una sugerencia pasiva no bloqueante con
// timeout de cliente de 8s (RecomendacionesIA.tsx), un solo intento basta.
export const maxDuration = 25;

export const POST = withErrorLogging(async (req: NextRequest) => {
  // 1. Auth — cualquier usuario autenticado de la tienda (workers y admins)
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id, userId } = ctx;

  // 2. Validar body
  const body = await req.json().catch(() => ({}));
  const parsed = POSRecomendadorRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { clienteId, mascotaId, itemsCarrito } = parsed.data;

  // 3. Verificar API key
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OpenRouter no configurado" }, { status: 503 });
  }

  const supabase = createServiceClient();

  // 4. Leer modelo + ubicación de la tienda
  const { data: store } = await supabase
    .from("stores")
    .select("openrouter_model, ciudad, lat, lon")
    .eq("id", store_id)
    .single();
  const model    = store?.openrouter_model ?? process.env.OPENROUTER_MODEL ?? "z-ai/glm-4.5-air:free";
  const ciudad   = store?.ciudad ?? "Santiago";
  const storeLat = (store?.lat as number | null) ?? SANTIAGO_LAT;
  const storeLon = (store?.lon as number | null) ?? SANTIAGO_LON;

  // 5. Catálogo: 60 productos activos con stock
  const { data: catRaw } = await supabase
    .from("productos")
    .select("id, nombre, precio, categoria_id")
    .eq("store_id", store_id)
    .eq("activo", true)
    .gt("stock", 0)
    .limit(60);

  // 5b. Mapa de categorías
  const { data: cats } = await supabase
    .from("categorias")
    .select("id, nombre")
    .eq("store_id", store_id);
  const catMap = new Map((cats ?? []).map((c) => [c.id, c.nombre as string]));

  const catalogo = (catRaw ?? []).map((p) => ({
    id:        p.id as string,
    nombre:    p.nombre as string,
    precio:    Number(p.precio),
    categoria: catMap.get(p.categoria_id as string) ?? "General",
  }));
  const catalogoResumido = catalogo.map((p) => ({ nombre: p.nombre, categoria: p.categoria }));

  // 6. Mascotas + historial del cliente (si hay clienteId)
  let clienteNombre = "Cliente";
  let mascotas: ContextoPOS["mascotas"] = [];
  let historial: { nombre: string; categoria: string; fecha: string }[] = [];
  const alimentoMap = new Map(catalogo.map((p) => [p.id, p.nombre]));

  if (clienteId) {
    const { data: cli } = await supabase
      .from("clientes")
      .select("nombre")
      .eq("id", clienteId)
      .single();
    clienteNombre = cli?.nombre ?? "Cliente";

    // Mascotas — filtrar por mascotaId si viene especificado
    const mascotaQuery = supabase
      .from("mascotas")
      .select("nombre, tipo, raza, peso_kg, alimento_habitual_id")
      .eq("cliente_id", clienteId);
    const { data: mascotasRaw } = mascotaId
      ? await mascotaQuery.eq("id", mascotaId)
      : await mascotaQuery;

    mascotas = (mascotasRaw ?? []).map((m) => ({
      nombre:            m.nombre as string,
      tipo:              m.tipo as string,
      raza:              m.raza ?? undefined,
      peso_kg:           m.peso_kg ?? undefined,
      alimento_habitual: m.alimento_habitual_id
        ? alimentoMap.get(m.alimento_habitual_id as string)
        : undefined,
    }));

    // Historial: últimas 5 ventas → items
    const { data: ventas } = await supabase
      .from("ventas")
      .select("id, created_at")
      .eq("store_id", store_id)
      .eq("cliente_id", clienteId)
      .order("created_at", { ascending: false })
      .limit(5);

    const ventaIds = (ventas ?? []).map((v) => v.id as string);
    if (ventaIds.length > 0) {
      const { data: items } = await supabase
        .from("venta_items")
        .select("producto_id, created_at")
        .in("venta_id", ventaIds)
        .limit(20);

      const prodMap = new Map(catalogo.map((p) => [p.id, p]));
      historial = (items ?? [])
        .map((item) => {
          const prod = prodMap.get(item.producto_id as string);
          if (!prod) return null;
          return {
            nombre:    prod.nombre,
            categoria: prod.categoria,
            fecha:     new Date(item.created_at as string).toISOString().split("T")[0],
          };
        })
        .filter((h): h is NonNullable<typeof h> => h !== null);
    }
  }

  // 7. Construir cache key
  // Usa: productos del carrito + tipo+raza de mascota primaria + temporada + ciudad
  const clima = await obtenerContextoClimatico(storeLat, storeLon);
  const mascotaPrimaria = mascotas[0];
  const cacheKeyData = {
    productos:     [...itemsCarrito.map((i) => i.producto_id)].sort(),
    mascota_tipo:  mascotaPrimaria?.tipo ?? null,
    raza:          mascotaPrimaria?.raza ?? null,
    temporada:     clima.temporada,
    ciudad,
  };
  const cacheKey = createHash("sha256")
    .update(JSON.stringify(cacheKeyData))
    .digest("hex")
    .slice(0, 32);

  // 8. Consultar cache
  const hace7Dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: cached } = await supabase
    .from("ai_pos_cache")
    .select("recomendaciones")
    .eq("store_id", store_id)
    .eq("cache_key", cacheKey)
    .gte("created_at", hace7Dias)
    .single();

  if (cached) {
    // Cache hit: resolver directamente
    const recsFromCache = cached.recomendaciones as RecomendacionPOS[];
    return NextResponse.json(
      buildResult(recsFromCache, catalogo, itemsCarrito),
      { headers: { "X-Cache": "HIT" } }
    );
  }

  // 9. Cache miss: llamar al LLM
  const itemsParaContexto = itemsCarrito.map((i) => ({
    nombre:    i.nombre,
    categoria: i.categoria ?? "General",
    cantidad:  1,
  }));

  const contexto = {
    items_carrito:     itemsParaContexto,
    cliente_nombre:    clienteNombre,
    mascotas,
    historial_reciente: historial,
    clima,
    fecha_hoy:         new Date().toISOString().split("T")[0],
  };

  let recsLLM: RecomendacionPOS[];
  try {
    recsLLM = await recomendarProductosEnPOS(apiKey, model, contexto, catalogoResumido);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error inesperado";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // 10. Guardar en cache (fire-and-forget, no bloquear respuesta)
  (async () => {
    await supabase.from("ai_pos_cache").upsert(
      { store_id, cache_key: cacheKey, recomendaciones: recsLLM, temporada: clima.temporada },
      { onConflict: "store_id,cache_key" }
    );
  })().catch(() => {});

  // 11. Log audit (fire-and-forget)
  const { ipAddress, userAgent } = await getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId,
    action: "AI_RECOMMENDATION",
    entityType: "pos_recommender",
    newValues: { items_count: itemsCarrito.length, cache_key: cacheKey, cache_hit: false },
    changeDescription: `Recomendaciones IA generadas para ${clienteNombre}`,
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

  return NextResponse.json(
    buildResult(recsLLM, catalogo, itemsCarrito),
    { headers: { "X-Cache": "MISS" } }
  );
}, { endpoint: "POST /api/ai/pos/recomendar" });

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface ContextoPOS {
  items_carrito:     { nombre: string; categoria: string; cantidad: number }[];
  cliente_nombre:    string;
  mascotas:          { nombre: string; tipo: string; raza?: string; peso_kg?: number; alimento_habitual?: string }[];
  historial_reciente: { nombre: string; categoria: string; fecha: string }[];
  clima:             { temperatura: number; descripcion: string; temporada: string };
  fecha_hoy:         string;
}

interface RecomendacionPOS {
  nombre_producto: string;
  razon:           string;
  urgencia:        "alta" | "media" | "baja";
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function buildResult(
  recs:         RecomendacionPOS[],
  catalogo:     { id: string; nombre: string; precio: number; categoria: string }[],
  itemsCarrito: { producto_id: string; nombre: string }[]
) {
  const carritoIds = new Set(itemsCarrito.map((i) => i.producto_id));

  const resultados = recs
    .map((rec) => {
      // Buscar en catálogo por nombre exacto primero, luego parcial
      const exact = catalogo.find(
        (p) => p.nombre.toLowerCase() === rec.nombre_producto.toLowerCase()
      );
      const match =
        exact ??
        catalogo.find((p) =>
          p.nombre.toLowerCase().includes(rec.nombre_producto.toLowerCase().split(" ")[0])
        );
      if (!match) return null;
      if (carritoIds.has(match.id)) return null; // ya está en el carrito
      return {
        producto_id: match.id,
        nombre:      match.nombre,
        precio:      match.precio,
        categoria:   match.categoria,
        razon:       rec.razon,
        urgencia:    rec.urgencia,
      };
    })
    .filter(Boolean);

  return { recomendaciones: resultados };
}