import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { ServicioUpdateSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import type { ServicioConHorarios, ServicioHorario } from "@/types";

// GET /api/servicios/[id] — un servicio con sus horarios anidados.
// Lectura abierta a cualquier usuario autenticado de la tienda.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("servicios")
    .select("*, servicio_horarios(*)")
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  // El embed de Supabase no garantiza orden; reordenamos por dia_semana.
  const horariosOrdenados = (data.servicio_horarios ?? []).slice().sort(
    (a: ServicioHorario, b: ServicioHorario) => a.dia_semana - b.dia_semana
  );
  const result: ServicioConHorarios = { ...(data as ServicioConHorarios), servicio_horarios: horariosOrdenados };
  return NextResponse.json(result);
}

// PATCH /api/servicios/[id] — actualización parcial. Solo storeAdmin / systemAdmin.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const parsed = ServicioUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.nombre !== undefined) updates.nombre = parsed.data.nombre.trim();
  if (parsed.data.descripcion !== undefined) updates.descripcion = parsed.data.descripcion?.trim() || null;
  if (parsed.data.duracion_minutos !== undefined) updates.duracion_minutos = parsed.data.duracion_minutos;
  if (parsed.data.activo !== undefined) updates.activo = parsed.data.activo;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Fetch previo para oldValues de auditoría (y para detectar 404 sin actualizar).
  const { data: existing } = await supabase
    .from("servicios")
    .select("id, nombre, descripcion, duracion_minutos, activo")
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .single();
  if (!existing) {
    return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("servicios")
    .update(updates)
    .eq("id", id)
    .eq("store_id", ctx.storeId) // defensa en profundidad además del admin check
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ya existe un servicio con ese nombre" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId,
    action: "UPDATE",
    entityType: "servicio",
    entityId: id,
    oldValues: existing,
    newValues: updates,
    changeDescription: `Servicio actualizado: ${Object.keys(updates).join(", ")}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json(data);
}

// DELETE /api/servicios/[id] — soft delete (activo: false). Solo storeAdmin / systemAdmin.
// No toca servicio_horarios: quedan intactos y vuelven a aplicar si el servicio se reactiva.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    .from("servicios")
    .select("id, nombre, descripcion, duracion_minutos, activo")
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .single();
  if (!existing) {
    return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 });
  }

  const { error } = await supabase
    .from("servicios")
    .update({ activo: false })
    .eq("id", id)
    .eq("store_id", ctx.storeId);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId,
    action: "DELETE",
    entityType: "servicio",
    entityId: id,
    oldValues: existing,
    changeDescription: `Servicio "${existing.nombre ?? id}" eliminado (soft delete)`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return new NextResponse(null, { status: 204 });
}
