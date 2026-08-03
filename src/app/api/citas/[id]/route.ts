import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { CitaAccionSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata } from "@/lib/audit";

// GET /api/citas/[id] — detalle con joins. Abierto a la tienda.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("citas")
    .select("*, cliente:clientes(nombre, telefono), mascota:mascotas(nombre), servicio:servicios(nombre)")
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  return NextResponse.json(data);
}

// PATCH /api/citas/[id] — acciones de estado: cancelar (vía RPC atómico),
// completar, no_show (update simple con guarda de estado). No requiere rol
// admin (decisión §9a). No hay DELETE: cancelar es un cambio de estado.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const parsed = CitaAccionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createServiceClient();

  if (parsed.data.accion === "cancelar") {
    const { data, error } = await supabase.rpc("cancelar_cita_tx", {
      p_cita_id: id,
      p_store_id: ctx.storeId,
      p_motivo: parsed.data.motivo,
      p_cancelado_por: ctx.userId,
    });

    if (error) {
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
      }
      if (error.code === "PS003") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }

    const { ipAddress, userAgent } = getRequestMetadata(req);
    logAudit({
      storeId: ctx.storeId,
      userId: ctx.userId,
      action: "UPDATE",
      entityType: "cita",
      entityId: id,
      newValues: { estado: "cancelada", motivo: parsed.data.motivo },
      changeDescription: `Cita cancelada: ${parsed.data.motivo}`,
      ipAddress,
      userAgent,
    }).catch(() => {});

    return NextResponse.json(data);
  }

  // completar / no_show: transición de una sola tabla sin RPC (no hay
  // invariante cruzada que proteger). SELECT previo distingue 404 de 409.
  const nuevoEstado = parsed.data.accion === "completar" ? "completada" : "no_show";

  const { data: existing } = await supabase
    .from("citas")
    .select("id, estado")
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .single();
  if (!existing) {
    return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
  }
  if (existing.estado !== "confirmada") {
    return NextResponse.json(
      { error: `No se puede marcar como ${nuevoEstado} una cita en estado ${existing.estado}` },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("citas")
    .update({ estado: nuevoEstado })
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .eq("estado", "confirmada") // defensa contra carrera entre SELECT y UPDATE
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "cita",
    entityId: id,
    oldValues: { estado: existing.estado },
    newValues: { estado: nuevoEstado },
    changeDescription: `Cita marcada como ${nuevoEstado}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json(data);
}
