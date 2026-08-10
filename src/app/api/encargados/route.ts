import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { EncargadoCreateSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";

// GET /api/encargados — encargados activos de la tienda con conteo de citas
// (citas_totales / citas_completadas). Lectura abierta a cualquier usuario
// autenticado de la tienda (igual que GET /api/servicios).
export const GET = withErrorLogging(async () => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("encargados")
    .select("id, nombre, activo")
    .eq("store_id", ctx.storeId)
    .eq("activo", true)
    .order("nombre");

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  // Conteos de citas agregados server-side (mismo enfoque que
  // /api/workers con ventas_mes/ventas_hoy) — el cliente no hace queries extra.
  const { data: citas, error: citasError } = await supabase
    .from("citas")
    .select("encargado_id, estado")
    .eq("store_id", ctx.storeId)
    .not("encargado_id", "is", null);

  if (citasError) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const totales: Record<string, number> = {};
  const completadas: Record<string, number> = {};
  for (const c of citas ?? []) {
    const id = c.encargado_id as string;
    totales[id] = (totales[id] ?? 0) + 1;
    if (c.estado === "completada") completadas[id] = (completadas[id] ?? 0) + 1;
  }

  const result = (data ?? []).map((e) => ({
    ...e,
    citas_totales: totales[e.id] ?? 0,
    citas_completadas: completadas[e.id] ?? 0,
  }));

  return NextResponse.json(result);
}, { endpoint: "GET /api/encargados" });

// POST /api/encargados — crear un encargado. Solo storeAdmin / systemAdmin.
// store_id SIEMPRE del contexto autenticado; el schema no acepta store_id del body.
export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionClaims, userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminStatus(sessionClaims);
  try {
    requireStoreAdmin(admin, ctx.storeId);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = EncargadoCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("encargados")
    .insert({
      store_id: ctx.storeId,
      nombre: parsed.data.nombre.trim(),
    })
    .select()
    .single();

  if (error) {
    const { ipAddress, userAgent } = getRequestMetadata(req);
    logAudit({
      storeId: ctx.storeId,
      userId,
      action: "CREATE",
      entityType: "encargado",
      changeDescription: "Error creando encargado",
      ipAddress,
      userAgent,
      result: "failure",
      errorMessage: error.message,
    }).catch(() => {});
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ya existe un encargado con ese nombre" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId,
    action: "CREATE",
    entityType: "encargado",
    entityId: data.id,
    newValues: { nombre: parsed.data.nombre },
    changeDescription: `Encargado "${parsed.data.nombre}" creado`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json(data, { status: 201 });
}, { endpoint: "POST /api/encargados" });
