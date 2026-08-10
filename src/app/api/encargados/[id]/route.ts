import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { EncargadoUpdateSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";

// GET /api/encargados/[id] — detalle. Lectura abierta a cualquier usuario
// autenticado de la tienda.
export const GET = withErrorLogging(async (_req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("encargados")
    .select("*")
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ error: "Encargado no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  return NextResponse.json(data);
}, { endpoint: "GET /api/encargados/id" });

// PATCH /api/encargados/[id] — actualización parcial (nombre, activo).
// Solo storeAdmin / systemAdmin.
export const PATCH = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
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

  const { id } = await params;
  const body = await req.json();
  const parsed = EncargadoUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.nombre !== undefined) updates.nombre = parsed.data.nombre.trim();
  if (parsed.data.activo !== undefined) updates.activo = parsed.data.activo;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Fetch previo para oldValues de auditoría (y para detectar 404 sin actualizar).
  const { data: existing } = await supabase
    .from("encargados")
    .select("id, nombre, activo")
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .single();
  if (!existing) {
    return NextResponse.json({ error: "Encargado no encontrado" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("encargados")
    .update(updates)
    .eq("id", id)
    .eq("store_id", ctx.storeId) // defensa en profundidad además del admin check
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ya existe un encargado con ese nombre" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId,
    action: "UPDATE",
    entityType: "encargado",
    entityId: id,
    oldValues: existing,
    newValues: updates,
    changeDescription: `Encargado actualizado: ${Object.keys(updates).join(", ")}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json(data);
}, { endpoint: "PATCH /api/encargados/id" });

// DELETE /api/encargados/[id] — soft delete (activo: false). Solo storeAdmin /
// systemAdmin. Baja lógica para no romper la referencia desde citas históricas
// (plan §0, decisión 4); nunca un DELETE real.
export const DELETE = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
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

  const { id } = await params;
  const supabase = createServiceClient();

  // Fetch previo para oldValues + detectar 404 antes de "eliminar".
  const { data: existing } = await supabase
    .from("encargados")
    .select("id, nombre, activo")
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .single();
  if (!existing) {
    return NextResponse.json({ error: "Encargado no encontrado" }, { status: 404 });
  }

  const { error } = await supabase
    .from("encargados")
    .update({ activo: false })
    .eq("id", id)
    .eq("store_id", ctx.storeId);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId,
    action: "DELETE",
    entityType: "encargado",
    entityId: id,
    oldValues: existing,
    changeDescription: `Encargado "${existing.nombre ?? id}" eliminado (soft delete)`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return new NextResponse(null, { status: 204 });
}, { endpoint: "DELETE /api/encargados/id" });
