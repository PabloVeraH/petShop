import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { z } from "zod";
import { crearAsiento } from "@/lib/contabilidad/generador-asientos";
import { checkExistingCierre } from "@/lib/contabilidad/cierre-mes";

const LineaSchema = z.object({
  cuenta_codigo: z.string().min(1).max(20),
  cuenta_nombre: z.string().min(1).max(255),
  cuenta_tipo: z.enum(["ACTIVO", "PASIVO", "PATRIMONIO", "INGRESO", "GASTO"]).optional(),
  debito: z.number().nonnegative().default(0),
  credito: z.number().nonnegative().default(0),
  descripcion_linea: z.string().max(255).optional(),
});

const AsientoManualSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descripcion: z.string().min(3).max(500),
  lineas: z.array(LineaSchema).min(2),
});

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const desde = req.nextUrl.searchParams.get("desde") ?? "";
  const hasta = req.nextUrl.searchParams.get("hasta") ?? "";
  const tipo = req.nextUrl.searchParams.get("tipo") ?? "";
  const search = req.nextUrl.searchParams.get("search") ?? "";
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");
  const LIMIT = 50;

  let query = supabase
    .from("journal_entries")
    .select("id, numero_asiento, fecha, tipo_movimiento, referencia_numero, descripcion, total_debito, total_credito, esta_balanceado, creado_por, created_at", { count: "exact" })
    .eq("store_id", store_id)
    .order("numero_asiento", { ascending: false })
    .range(offset, offset + LIMIT - 1);

  if (desde) query = query.gte("fecha", desde);
  if (hasta) query = query.lte("fecha", hasta);
  if (tipo) query = query.eq("tipo_movimiento", tipo);
  if (search) query = query.ilike("descripcion", `%${search}%`);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const totalDebitos = (data ?? []).reduce((s, e) => s + Number(e.total_debito), 0);
  const totalCreditos = (data ?? []).reduce((s, e) => s + Number(e.total_credito), 0);

  return NextResponse.json({
    data: data ?? [],
    total: count ?? 0,
    total_debitos: totalDebitos,
    total_creditos: totalCreditos,
    balanceado: Math.abs(totalDebitos - totalCreditos) < 0.01,
  });
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = AsientoManualSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { fecha, descripcion, lineas } = parsed.data;

  const totalD = lineas.reduce((s, l) => s + l.debito, 0);
  const totalC = lineas.reduce((s, l) => s + l.credito, 0);
  if (Math.abs(totalD - totalC) > 0.01) {
    return NextResponse.json(
      { error: `Asiento no balanceado: débito ${totalD} ≠ crédito ${totalC}` },
      { status: 400 }
    );
  }

  // El período contable ya puede estar cerrado. crearAsiento() rechaza
  // asientos con tipoMovimiento distinto de CIERRE_MES/ANULACION_VENTA (este
  // endpoint usa "AJUSTE", no exento) cuya fecha caiga en un período cerrado
  // (retorna null), pero sin este chequeo explícito el motivo se pierde en
  // el 500 genérico "Error creando asiento". Mismo patrón y causa raíz que
  // el fix de POST /api/contabilidad/aporte-capital (ticket Trello
  // 6a77ed665c4d8a8c726111ac) — encontrado durante esa revisión: este
  // endpoint es igualmente síncrono y visible al usuario, y acepta una
  // fecha arbitraria del cliente sin validar contra períodos cerrados.
  const periodo = fecha.substring(0, 7);
  const cierres = await checkExistingCierre(supabase, store_id, periodo);
  if (cierres > 0) {
    return NextResponse.json(
      {
        error: `El período ${periodo} ya está cerrado. Elige una fecha dentro de un período abierto para registrar este asiento.`,
      },
      { status: 409 }
    );
  }

  const id = await crearAsiento({
    storeId: store_id,
    fecha,
    tipoMovimiento: "AJUSTE",
    descripcion,
    lineas: lineas.map((l) => ({
      cuentaCodigo: l.cuenta_codigo,
      cuentaNombre: l.cuenta_nombre,
      cuentaTipo: l.cuenta_tipo,
      debito: l.debito,
      credito: l.credito,
      descripcionLinea: l.descripcion_linea,
    })),
    usuarioId: ctx.userId ?? undefined,
    creadoPor: "manual",
  });

  if (!id) return NextResponse.json({ error: "Error creando asiento" }, { status: 500 });

  const { data } = await supabase
    .from("journal_entries")
    .select("*, journal_detail(*)")
    .eq("id", id)
    .single();

  return NextResponse.json(data, { status: 201 });
}
