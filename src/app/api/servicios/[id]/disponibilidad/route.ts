import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { DisponibilidadQuerySchema } from "@/lib/validation";
import { calcularSlotsDisponibles, diaSemanaIsoDesdeFecha, type RangoHorario } from "@/lib/disponibilidad";
import type { SlotDisponible } from "@/types";

// Normaliza "HH:MM:SS" → "HH:MM" (Postgres TIME serializa con segundos).
const hhmm = (v: string) => v.slice(0, 5);

// GET /api/servicios/[id]/disponibilidad?fecha=YYYY-MM-DD&encargado_id=...
// Calcula slots libres del día: ventana horaria (excepción > horario semanal)
// menos los rangos ocupados por el servicio Y por el encargado (plan §4 —
// encargado_id es obligatorio: sin él la UI podría mostrar como "libre" un
// slot donde el encargado ya está ocupado en otro servicio). Usa la lib pura
// calcularSlotsDisponibles. Abierto a cualquier usuario autenticado de la tienda.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const parsed = DisponibilidadQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { fecha, encargado_id: encargadoId } = parsed.data;

  const supabase = createServiceClient();

  // Verifica ownership + activo.
  const { data: servicio } = await supabase
    .from("servicios")
    .select("id, duracion_minutos")
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .eq("activo", true)
    .single();
  if (!servicio) {
    return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 });
  }

  // Ventana horaria del día: excepción primero, si no horario semanal.
  const { data: excepcion } = await supabase
    .from("servicio_excepciones")
    .select("cerrado, hora_inicio, hora_fin")
    .eq("servicio_id", id)
    .eq("store_id", ctx.storeId)
    .eq("fecha", fecha)
    .maybeSingle();

  let ventana: RangoHorario | null = null;

  if (excepcion) {
    if (excepcion.cerrado) return NextResponse.json([]);
    ventana = { hora_inicio: hhmm(excepcion.hora_inicio!), hora_fin: hhmm(excepcion.hora_fin!) };
  } else {
    const diaSemana = diaSemanaIsoDesdeFecha(fecha);
    const { data: horario } = await supabase
      .from("servicio_horarios")
      .select("hora_inicio, hora_fin")
      .eq("servicio_id", id)
      .eq("store_id", ctx.storeId)
      .eq("dia_semana", diaSemana)
      .maybeSingle();
    if (!horario) return NextResponse.json([]);
    ventana = { hora_inicio: hhmm(horario.hora_inicio), hora_fin: hhmm(horario.hora_fin) };
  }

  // Rangos ocupados por el servicio: citas no canceladas del servicio ese día.
  const { data: citas, error: citasError } = await supabase
    .from("citas")
    .select("hora_inicio, hora_fin")
    .eq("servicio_id", id)
    .eq("store_id", ctx.storeId)
    .eq("fecha", fecha)
    .neq("estado", "cancelada");
  if (citasError) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  // Rangos ocupados por el encargado: cualquier cita (de CUALQUIER servicio)
  // del encargado ese día, sin filtrar por servicio_id — mismo chequeo que el
  // SQL de crear_cita_tx (plan §4). Complementa los rangos de arriba.
  const { data: citasEncargado, error: citasEncargadoError } = await supabase
    .from("citas")
    .select("hora_inicio, hora_fin")
    .eq("encargado_id", encargadoId)
    .eq("store_id", ctx.storeId)
    .eq("fecha", fecha)
    .neq("estado", "cancelada");
  if (citasEncargadoError) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const ocupados: RangoHorario[] = [
    ...(citas ?? []),
    ...(citasEncargado ?? []),
  ].map((c) => ({
    hora_inicio: hhmm(c.hora_inicio),
    hora_fin: hhmm(c.hora_fin),
  }));

  const slots: SlotDisponible[] = calcularSlotsDisponibles(ventana, servicio.duracion_minutos, ocupados);
  return NextResponse.json(slots);
}
