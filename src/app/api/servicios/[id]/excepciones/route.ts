import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { ServicioExcepcionCreateSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata } from "@/lib/audit";

async function servicioDeLaTienda(servicioId: string, storeId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("servicios")
    .select("id")
    .eq("id", servicioId)
    .eq("store_id", storeId)
    .single();
  return !!data;
}

// GET /api/servicios/[id]/excepciones — lista de feriados/cierres del servicio.
// Abierto a cualquier usuario autenticado de la tienda (consulta, igual que horarios).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await servicioDeLaTienda(id, ctx.storeId))) {
    return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("servicio_excepciones")
    .select("*")
    .eq("servicio_id", id)
    .eq("store_id", ctx.storeId)
    .order("fecha");

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/servicios/[id]/excepciones — agregar un feriado/cierre.
// Solo storeAdmin/systemAdmin (es configuración, igual que horarios en Fase 1).
export async function POST(
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
  if (!(await servicioDeLaTienda(id, ctx.storeId))) {
    return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = ServicioExcepcionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("servicio_excepciones")
    .insert({
      store_id: ctx.storeId, // siempre del contexto, nunca del body
      servicio_id: id,       // siempre del path, nunca del body
      fecha: parsed.data.fecha,
      cerrado: parsed.data.cerrado,
      hora_inicio: parsed.data.cerrado ? null : parsed.data.hora_inicio!,
      hora_fin: parsed.data.cerrado ? null : parsed.data.hora_fin!,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ya existe una excepción para esa fecha" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId,
    action: "CREATE",
    entityType: "servicio_excepcion",
    entityId: data.id,
    newValues: parsed.data,
    changeDescription: `Excepción ${parsed.data.fecha} creada para servicio ${id}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json(data, { status: 201 });
}
