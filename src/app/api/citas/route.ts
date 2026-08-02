import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { CitaCreateSchema, CitasQuerySchema } from "@/lib/validation";
import { logAudit, getRequestMetadata } from "@/lib/audit";

// GET /api/citas — listado con filtros opcionales (fecha, servicio_id,
// cliente_id, estado). Abierto a cualquier usuario autenticado de la tienda.
export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = CitasQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createServiceClient();
  let query = supabase
    .from("citas")
    .select("*, clientes(nombre, telefono), mascotas(nombre), servicios(nombre)")
    .eq("store_id", ctx.storeId);

  if (parsed.data.fecha) query = query.eq("fecha", parsed.data.fecha);
  if (parsed.data.servicio_id) query = query.eq("servicio_id", parsed.data.servicio_id);
  if (parsed.data.cliente_id) query = query.eq("cliente_id", parsed.data.cliente_id);
  if (parsed.data.estado) query = query.eq("estado", parsed.data.estado);

  const { data, error } = await query.order("fecha").order("hora_inicio");

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/citas — crear una cita. Cualquier usuario autenticado de la
// tienda (decisión §9a: operación de staff, como registrar una venta en POS).
// store_id y created_by SIEMPRE del contexto; el schema ni acepta esos campos.
export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CitaCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("crear_cita_tx", {
    p_store_id: ctx.storeId,
    p_servicio_id: parsed.data.servicio_id,
    p_cliente_id: parsed.data.cliente_id,
    p_mascota_id: parsed.data.mascota_id ?? null,
    p_fecha: parsed.data.fecha,
    p_hora_inicio: parsed.data.hora_inicio,
    p_notas: parsed.data.notas ?? null,
    p_created_by: ctx.userId,
  });

  if (error) {
    if (error.code === "P0002") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error.code === "PS001") {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error.code === "PS002") {
      return NextResponse.json({ error: "El horario solicitado ya está reservado" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId: ctx.userId,
    action: "CREATE",
    entityType: "cita",
    entityId: data.id,
    newValues: data,
    changeDescription: `Cita creada para servicio ${parsed.data.servicio_id} el ${parsed.data.fecha} ${parsed.data.hora_inicio}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json(data, { status: 201 });
}
