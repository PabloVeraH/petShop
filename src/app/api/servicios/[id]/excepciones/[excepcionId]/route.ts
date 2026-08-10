import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";

// DELETE /api/servicios/[id]/excepciones/[excepcionId] — hard delete.
// Solo admin. Hard delete (a diferencia del soft-delete de servicios) porque
// una excepción no tiene referencias entrantes: es un toggle de configuración.
export const DELETE = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string; excepcionId: string }> }) => {
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

  const { id, excepcionId } = await params;
  const supabase = createServiceClient();

  // Fetch previo para oldValues + distinguir 404 (incluye servicio_id y
  // store_id en el filtro — defensa en profundidad, §6.1).
  const { data: existing } = await supabase
    .from("servicio_excepciones")
    .select("id, fecha, cerrado, hora_inicio, hora_fin")
    .eq("id", excepcionId)
    .eq("servicio_id", id)
    .eq("store_id", ctx.storeId)
    .single();
  if (!existing) {
    return NextResponse.json({ error: "Excepción no encontrada" }, { status: 404 });
  }

  const { error } = await supabase
    .from("servicio_excepciones")
    .delete()
    .eq("id", excepcionId)
    .eq("servicio_id", id)
    .eq("store_id", ctx.storeId);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId,
    action: "DELETE",
    entityType: "servicio_excepcion",
    entityId: excepcionId,
    oldValues: existing,
    changeDescription: `Excepción ${existing.fecha} eliminada del servicio ${id}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return new NextResponse(null, { status: 204 });
}, { endpoint: "DELETE /api/servicios/id/excepciones/excepcionId" });
