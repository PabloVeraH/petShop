import { getStoreId }           from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { createServiceClient }  from "@/lib/supabase";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { OptimizadorVencimientosRequestSchema } from "@/lib/validation";
import { analizarVencimientosConIA } from "@/lib/openrouter";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

// El modelo free-tier de OpenRouter puede tener cold-start (~20-30s). Un solo
// reintento tras esa ventana suele alcanzar al modelo ya "tibio". maxDuration
// se declara explícitamente para que ambos intentos (20s c/u) + la espera entre
// ellos quepan dentro del límite de la función antes de que la plataforma la
// mate y sirva una página de error HTML (la causa raíz original del bug).
export const maxDuration = 50;

const REINTENTOS_TIMEOUT_IA = 1;
const ESPERA_ENTRE_REINTENTOS_MS = 2000;

// Reintenta analizarVencimientosConIA una vez, únicamente cuando el fallo es
// el timeout de cold-start (nunca ante 401/429/5xx/parseo — esos no se
// resuelven reintentando de inmediato).
async function analizarConReintentoSiTimeout(
  ...args: Parameters<typeof analizarVencimientosConIA>
): ReturnType<typeof analizarVencimientosConIA> {
  for (let intento = 0; ; intento++) {
    try {
      return await analizarVencimientosConIA(...args);
    } catch (e) {
      const esTimeout = e instanceof Error && e.message.includes("no respondió a tiempo");
      if (!esTimeout || intento >= REINTENTOS_TIMEOUT_IA) throw e;
      await new Promise((resolve) => setTimeout(resolve, ESPERA_ENTRE_REINTENTOS_MS));
    }
  }
}

export async function GET() {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  try {
    requireStoreAdmin(admin);
  } catch {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("ai_vencimientos_analisis")
    .select("recomendaciones, modelo_usado, productos_analizados, created_at, dias_alerta")
    .eq("store_id", store_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!data) return NextResponse.json(null);

  // Cross-validar recomendaciones cacheadas contra el catálogo actual
  const recs = data.recomendaciones as { producto_id: string; nombre: string; sku: string; dias_hasta_vencer: number; stock: number; precio_actual: number; descuento_recomendado: number; motivo: string; fecha_vencimiento?: string }[];
  if (!recs?.length) return NextResponse.json(data);

  const productoIds = recs.map(r => r.producto_id);
  const { data: productosActuales } = await supabase
    .from("productos")
    .select("id, activo, stock, fecha_vencimiento")
    .eq("store_id", store_id)
    .in("id", productoIds);

  const currentMap = new Map((productosActuales ?? []).map(p => [p.id, p]));

  const hoy = new Date();
  const validas: (typeof recs[number] & { datos_desactualizados: boolean })[] = [];
  let productosObsoletos = 0;

  for (const rec of recs) {
    const actual = currentMap.get(rec.producto_id);
    // Obsoleta si el producto ya no existe, fue desactivado, o ya no tiene
    // fecha_vencimiento (ej. se desactivó el seguimiento de vencimiento tras
    // el análisis) — en ese caso la premisa de la recomendación ("esto
    // vence pronto") ya no tiene base real y mostrar el dias_hasta_vencer
    // cacheado sería una referencia obsoleta, igual que un producto inactivo.
    if (!actual || !actual.activo || !actual.fecha_vencimiento) {
      productosObsoletos++;
      continue;
    }
    const stockFresco = Number(actual.stock);
    // Días/Stock se refrescan contra el catálogo actual, pero razon/
    // mensaje_whatsapp/urgencia/estrategia/descuento fueron generados por el
    // LLM en el momento del análisis y NO se regeneran aquí. Si el stock o la
    // fecha_vencimiento cambiaron desde entonces (nuevo lote, venta, ajuste),
    // ese texto ya no describe los números que se muestran en la fila —
    // marcarlo para que el frontend lo señale en vez de mezclar datos vivos
    // y texto obsoleto sin aviso (fecha_vencimiento solo se compara si el
    // análisis cacheado la registró; análisis previos a este fix no la
    // tienen y no deben generar falsos positivos).
    const datosDesactualizados =
      (rec.fecha_vencimiento != null && rec.fecha_vencimiento !== actual.fecha_vencimiento) ||
      Number(rec.stock) !== stockFresco;
    validas.push({
      ...rec,
      dias_hasta_vencer: Math.floor((new Date(actual.fecha_vencimiento).getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)),
      stock: stockFresco,
      datos_desactualizados: datosDesactualizados,
    });
  }

  return NextResponse.json({
    ...data,
    recomendaciones: validas,
    productos_obsoletos: productosObsoletos,
  });
}

export async function POST(req: NextRequest) {
  // 1. Auth — solo storeAdmin
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id, userId } = ctx;

  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  try {
    requireStoreAdmin(admin);
  } catch {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  // 2. Validar body
  const body = await req.json().catch(() => ({}));
  const parsed = OptimizadorVencimientosRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { diasAlerta } = parsed.data;

  // 3. Verificar API key configurada
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OpenRouter no configurado. Contacta al administrador." }, { status: 503 });
  }

  const supabase = createServiceClient();

  // 4. Leer modelo configurado para esta tienda
  const { data: store } = await supabase
    .from("stores")
    .select("openrouter_model")
    .eq("id", store_id)
    .single();
  const model = store?.openrouter_model
    ?? process.env.OPENROUTER_MODEL
    ?? "z-ai/glm-4.5-air:free";

  // 5. Obtener productos próximos a vencer con stock > 0
  const hoy = new Date();
  const fechaLimite = new Date(hoy);
  fechaLimite.setDate(fechaLimite.getDate() + diasAlerta);
  const fechaLimiteStr = fechaLimite.toISOString().split("T")[0];
  const fechaHoyStr    = hoy.toISOString().split("T")[0];

  const { data: productos, error: productosError } = await supabase
    .from("productos")
    .select("id, nombre, sku, stock, precio, costo, fecha_vencimiento")
    .eq("store_id", store_id)
    .eq("activo", true)
    .not("fecha_vencimiento", "is", null)
    .lte("fecha_vencimiento", fechaLimiteStr)
    .gt("stock", 0)
    .order("fecha_vencimiento", { ascending: true });

  if (productosError) {
    return NextResponse.json({ error: "Error al obtener productos" }, { status: 500 });
  }

  if (!productos || productos.length === 0) {
    return NextResponse.json({ recomendaciones: [], modelo_usado: model, productos_analizados: 0 });
  }

  // 6. Velocidad de ventas: unidades vendidas en los últimos 30 días
  const productoIds = productos.map(p => p.id);
  const hace30Dias  = new Date(hoy);
  hace30Dias.setDate(hace30Dias.getDate() - 30);

  const { data: ventasRecientes } = await supabase
    .from("venta_items")
    .select("producto_id, cantidad")
    .in("producto_id", productoIds)
    .gte("created_at", hace30Dias.toISOString());

  const velocidadMap: Record<string, number> = {};
  for (const vi of ventasRecientes ?? []) {
    velocidadMap[vi.producto_id] = (velocidadMap[vi.producto_id] ?? 0) + vi.cantidad;
  }

  // 7. Enriquecer datos para el LLM
  const productosParaIA = productos.map(p => ({
    producto_id:          p.id,
    nombre:               p.nombre,
    sku:                  p.sku,
    stock:                p.stock,
    precio_actual:        Number(p.precio),
    costo:                p.costo ? Number(p.costo) : null,
    fecha_vencimiento:    p.fecha_vencimiento,
    dias_hasta_vencer:    Math.floor(
      (new Date(p.fecha_vencimiento).getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)
    ),
    unidades_vendidas_30d: velocidadMap[p.id] ?? 0,
  }));

  // 8. Llamar al LLM vía OpenRouter
  let recomendaciones;
  try {
    const rawRecs = await analizarConReintentoSiTimeout(apiKey, model, productosParaIA, fechaHoyStr);
    // Merge back stock, dias_hasta_vencer y fecha_vencimiento desde
    // productosParaIA (el LLM no los retorna). fecha_vencimiento se persiste
    // junto a la recomendación para que GET() pueda detectar más adelante si
    // el producto cambió desde este análisis (nuevo lote, restock) y marcar
    // la fila como desactualizada en vez de mezclar texto viejo con columnas
    // de datos en vivo sin aviso.
    const productoMap = new Map(productosParaIA.map(p => [p.producto_id, p]));
    recomendaciones = rawRecs
      .filter(rec => {
        const existe = productoMap.has(rec.producto_id);
        if (!existe) console.warn("IA devolvió producto_id no existente en el lote analizado:", rec.producto_id);
        return existe;
      })
      .map(rec => ({
        ...rec,
        dias_hasta_vencer: productoMap.get(rec.producto_id)!.dias_hasta_vencer,
        stock:             productoMap.get(rec.producto_id)!.stock,
        fecha_vencimiento: productoMap.get(rec.producto_id)!.fecha_vencimiento,
      }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error inesperado al llamar al modelo";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // 9. Persistir análisis en BD (fire-and-forget)
  const createdAt = new Date().toISOString();
  (async () => {
    await supabase.from("ai_vencimientos_analisis").insert({
      store_id,
      modelo_usado:         model,
      dias_alerta:          diasAlerta,
      productos_analizados: productos.length,
      recomendaciones,
    });
  })().catch(() => {});

  // 10. Audit log (fire-and-forget)
  const { ipAddress, userAgent } = await getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId:  userId || "unknown",
    action:  "CREATE",
    entityType: "ai_optimizador_vencimientos",
    newValues:  { modelo: model, productos_analizados: productos.length, dias_alerta: diasAlerta },
    changeDescription: `Análisis IA de vencimientos: ${productos.length} productos con modelo ${model}`,
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

  return NextResponse.json({
    recomendaciones,
    modelo_usado:        model,
    productos_analizados: productos.length,
    created_at:          createdAt,
    dias_alerta:         diasAlerta,
  });
}