import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { LiquidacionCanalSchema } from "@/lib/validation";
import { crearAsiento, lineasLiquidacionCanal } from "@/lib/contabilidad/generador-asientos";
import { checkExistingCierre } from "@/lib/contabilidad/cierre-mes";
import { CANALES_EXTERNOS } from "@/lib/canales/domain/types";
import { autorizarCanales } from "@/lib/canales/infrastructure/autorizacion";

// Liquidaciones de plataformas (Fase 5, paso 5.2). Solo storeAdmin/systemAdmin
// (datos financieros, 5.1). D17: la comisión se contabiliza al registrar la
// liquidación real; D24: Dr Banco (neto) + Dr Comisiones (neto de IVA) +
// Dr IVA crédito / Cr CxC canal (bruto) — lineasLiquidacionCanal.
//
// Hallazgo V25 (corregido aquí): la versión anterior no tenía control de rol
// e insertaba columnas inexistentes (periodo_inicio, periodo_fin,
// total_ventas, estado) → todo POST fallaba con 500; el GET filtraba por una
// columna `periodo` inexistente. Tampoco generaba asiento.

const filtroSchema = z.object({
  canal: z.enum(CANALES_EXTERNOS).optional(),
});

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await autorizarCanales({ soloAdmin: true });
  if (!ctx.ok) return ctx.response;

  const filtro = filtroSchema.safeParse({ canal: req.nextUrl.searchParams.get("canal") ?? undefined });
  if (!filtro.success) return NextResponse.json({ error: "Canal inválido" }, { status: 400 });

  const supabase = createServiceClient();
  let query = supabase
    .from("canal_liquidaciones")
    .select("id, canal_id, periodo_desde, periodo_hasta, monto_bruto, comision, monto_neto, referencia, journal_entry_id, created_at")
    .eq("store_id", ctx.storeId);
  if (filtro.data.canal) query = query.eq("canal_id", filtro.data.canal);

  const { data, error } = await query.order("periodo_hasta", { ascending: false });
  if (error) return NextResponse.json({ error: "Error obteniendo liquidaciones" }, { status: 500 });
  return NextResponse.json(data ?? []);
}, { endpoint: "GET /api/canales/liquidacion" });

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await autorizarCanales({ soloAdmin: true });
  if (!ctx.ok) return ctx.response;
  const { storeId, userId } = ctx;

  const parsed = LiquidacionCanalSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const { canal_id, periodo_desde, periodo_hasta, fecha_deposito, monto_bruto, comision, referencia } = parsed.data;
  const monto_neto = monto_bruto - comision;

  const supabase = createServiceClient();

  // crearAsiento rechaza un período cerrado devolviendo null; se valida antes
  // para responder con un motivo accionable (mismo patrón que aporte-capital).
  const periodoContable = fecha_deposito.substring(0, 7);
  if ((await checkExistingCierre(supabase, storeId, periodoContable)) > 0) {
    return NextResponse.json(
      { error: `El período ${periodoContable} ya está cerrado. Usa una fecha de depósito de un período abierto.` },
      { status: 409 }
    );
  }

  const { data: liq, error } = await supabase
    .from("canal_liquidaciones")
    .insert({
      store_id: storeId,
      canal_id,
      periodo_desde,
      periodo_hasta,
      monto_bruto,
      comision,
      monto_neto,
      referencia: referencia || null,
    })
    .select("id")
    .single();
  if (error || !liq) {
    // UNIQUE (store, canal, período) — migración 083: doble carga.
    if (error?.code === "23505") {
      return NextResponse.json({ error: "Ya existe una liquidación de ese canal para ese período" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error creando la liquidación" }, { status: 500 });
  }

  const asientoId = await crearAsiento({
    storeId,
    fecha: fecha_deposito,
    tipoMovimiento: "LIQUIDACION_CANAL",
    canal: canal_id,
    referenciaId: liq.id,
    referenciaNomero: referencia || `${periodo_desde}/${periodo_hasta}`,
    descripcion: `Liquidación ${canal_id} ${periodo_desde} al ${periodo_hasta}`,
    lineas: lineasLiquidacionCanal({ canal: canal_id, montoBruto: monto_bruto, comision }),
    usuarioId: userId,
  }).catch((e: unknown) => {
    console.error("[canales/liquidacion] crearAsiento lanzó:", e instanceof Error ? e.message : e);
    return null;
  });

  if (!asientoId) {
    // Compensación: una liquidación sin asiento dejaría la CxC sin saldar sin
    // que nadie lo note. Se elimina y se informa el error.
    await supabase.from("canal_liquidaciones").delete().eq("id", liq.id).eq("store_id", storeId);
    return NextResponse.json({ error: "No se pudo registrar el asiento de la liquidación" }, { status: 500 });
  }

  const { error: errVinculo } = await supabase
    .from("canal_liquidaciones")
    .update({ journal_entry_id: asientoId })
    .eq("id", liq.id)
    .eq("store_id", storeId);
  if (errVinculo) {
    console.error(`[canales/liquidacion] asiento ${asientoId} creado pero no vinculado a la liquidación ${liq.id}`);
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId,
    userId,
    action: "CREATE",
    entityType: "canal_liquidaciones",
    entityId: liq.id,
    newValues: { canal_id, periodo_desde, periodo_hasta, monto_bruto, comision, monto_neto, journal_entry_id: asientoId },
    changeDescription: `Liquidación ${canal_id} ${periodo_desde} al ${periodo_hasta}: bruto $${monto_bruto.toLocaleString("es-CL")}, comisión $${comision.toLocaleString("es-CL")}`,
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

  return NextResponse.json({ id: liq.id, journal_entry_id: asientoId, monto_neto }, { status: 201 });
}, { endpoint: "POST /api/canales/liquidacion" });
