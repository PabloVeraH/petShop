import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { ServicioHorariosReplaceSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import type { ServicioHorario } from "@/types";

// GET /api/servicios/[id]/horarios — horario semanal del servicio (0 a 7 filas).
// Lectura abierta a cualquier usuario autenticado de la tienda.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = createServiceClient();

  // Verifica primero ownership del servicio.
  const { data: own } = await supabase
    .from("servicios")
    .select("id")
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .single();
  if (!own) {
    return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("servicio_horarios")
    .select("*")
    .eq("servicio_id", id)
    .eq("store_id", ctx.storeId)
    .order("dia_semana");

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// PUT /api/servicios/[id]/horarios — reemplazo TOTAL del horario semanal (no PATCH incremental).
// El body lleva la grilla completa (0 a 7 franjas); el RPC replace_servicio_horarios hace
// DELETE + INSERT atómico. Solo storeAdmin / systemAdmin.
export async function PUT(
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
  const parsed = ServicioHorariosReplaceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("replace_servicio_horarios", {
    p_servicio_id: id,
    p_store_id: ctx.storeId, // siempre del contexto, NUNCA del body
    p_horarios: parsed.data.horarios,
  });

  if (error) {
    if (error.code === "P0002") {
      return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  // Normalización "HH:MM:SS" → "HH:MM" para input type=time (inferido, no verificado
  // contra instancia real — ver docs/plan_servicios.md §2). Postgres TIME serializa
  // como "HH:MM:SS". Si algún horario trae ":SS", se recorta al mostrar en la UI;
  // la respuesta de la API preserva el formato de la BD para no perder información.
  const rows = (data ?? []) as ServicioHorario[];
  rows.sort((a, b) => a.dia_semana - b.dia_semana);

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId,
    action: "UPDATE",
    entityType: "servicio_horarios",
    entityId: id,
    newValues: { horarios: parsed.data.horarios },
    changeDescription: `Horario semanal del servicio ${id} reemplazado (${parsed.data.horarios.length} día(s))`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json(rows);
}
