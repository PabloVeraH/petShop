import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { ServicioCreateSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata } from "@/lib/audit";

// GET /api/servicios — catálogo de servicios activos de la tienda.
// Lectura abierta a cualquier usuario autenticado de la tienda (sin admin-check).
// Query param `incluir_inactivos=true`: lista también los inactivos (para
// reactivarlos desde el panel admin). Exige storeAdmin/systemAdmin para que
// el catálogo de agendamiento (workers) siga viendo solo activos.
export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createServiceClient();

  const incluirInactivos = new URL(req.url).searchParams.get("incluir_inactivos") === "true";

  if (incluirInactivos) {
    const { sessionClaims, userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const admin = getAdminStatus(sessionClaims);
    try {
      requireStoreAdmin(admin, ctx.storeId);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  let query = supabase
    .from("servicios")
    .select("id, nombre, descripcion, duracion_minutos, precio, activo")
    .eq("store_id", ctx.storeId);

  if (!incluirInactivos) query = query.eq("activo", true);

  const { data, error } = await query.order("nombre");

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/servicios — crear un servicio. Solo storeAdmin / systemAdmin.
// store_id SIEMPRE del contexto autenticado; el schema no acepta store_id del body.
export async function POST(req: NextRequest) {
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
  const parsed = ServicioCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("servicios")
    .insert({
      store_id: ctx.storeId,
      nombre: parsed.data.nombre.trim(),
      descripcion: parsed.data.descripcion?.trim() || null,
      duracion_minutos: parsed.data.duracion_minutos,
      precio: parsed.data.precio,
    })
    .select()
    .single();

  if (error) {
    const { ipAddress, userAgent } = getRequestMetadata(req);
    logAudit({
      storeId: ctx.storeId,
      userId,
      action: "CREATE",
      entityType: "servicio",
      changeDescription: "Error creando servicio",
      ipAddress,
      userAgent,
      result: "failure",
      errorMessage: error.message,
    }).catch(() => {});
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ya existe un servicio con ese nombre" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId,
    action: "CREATE",
    entityType: "servicio",
    entityId: data.id,
    newValues: { nombre: parsed.data.nombre, descripcion: parsed.data.descripcion, duracion_minutos: parsed.data.duracion_minutos, precio: parsed.data.precio },
    changeDescription: `Servicio "${parsed.data.nombre}" creado`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json(data, { status: 201 });
}
