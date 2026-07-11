import { getStoreId }           from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { createServiceClient }  from "@/lib/supabase";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { OptimizadorVencimientosRequestSchema } from "@/lib/validation";
import { analizarVencimientosConIA } from "@/lib/openrouter";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

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
  const recs = data.recomendaciones as { producto_id: string; nombre: string; sku: string; dias_hasta_vencer: number; stock: number; precio_actual: number; descuento_recomendado: number; motivo: string }[];
  if (!recs?.length) return NextResponse.json(data);

  const productoIds = recs.map(r => r.producto_id);
  const { data: productosActuales } = await supabase
    .from("productos")
    .select("id, activo, stock, fecha_vencimiento")
    .eq("store_id", store_id)
    .in("id", productoIds);

  const currentMap = new Map((productosActuales ?? []).map(p => [p.id, p]));

  const hoy = new Date();
  const validas: typeof recs = [];
  let productosObsoletos = 0;

  for (const rec of recs) {
    const actual = currentMap.get(rec.producto_id);
    if (!actual || !actual.activo) {
      productosObsoletos++;
      continue;
    }
    validas.push({
      ...rec,
      dias_hasta_vencer: actual.fecha_vencimiento
        ? Math.floor((new Date(actual.fecha_vencimiento).getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
        : rec.dias_hasta_vencer,
      stock: Number(actual.stock),
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
    const rawRecs = await analizarVencimientosConIA(apiKey, model, productosParaIA, fechaHoyStr);
    // Merge back stock y dias_hasta_vencer desde productosParaIA (el LLM no los retorna)
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