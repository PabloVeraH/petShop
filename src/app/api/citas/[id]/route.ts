import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { CitaAccionSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { extraerIva } from "@/lib/tax";
import { crearAsiento, lineasVentaPagos } from "@/lib/contabilidad/generador-asientos";
import { fechaNegocioDeTimestamp, hoyNegocioISO } from "@/lib/dates";
import {
  normalizarPagos, validarPagos, pagosParaRpc, estadoHttpErrorPago,
  type PagoInput, type PagoLegado,
} from "@/lib/ventas/pagos";
import { prevalidarNotaCredito } from "@/lib/ventas/prevalidar-nc";

// GET /api/citas/[id] — detalle con joins. Abierto a la tienda.
export const GET = withErrorLogging(async (_req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("citas")
    .select("*, cliente:clientes(nombre, telefono), mascota:mascotas(nombre), servicio:servicios(nombre), encargado:encargados(nombre)")
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
}, { endpoint: "GET /api/citas/id" });

// PATCH /api/citas/[id] — acciones de estado: cancelar (vía RPC atómico),
// completar, no_show (update simple con guarda de estado). No requiere rol
// admin (decisión §9a). No hay DELETE: cancelar es un cambio de estado.
export const PATCH = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
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

  // completar / no_show. Para "completar" hay dos caminos (plan §4): citas
  // legado (precio NULL, creadas antes de la migración 068) se completan sin
  // cobro con el UPDATE simple de siempre; citas con precio se cobran vía
  // completar_cita_tx. Ambos comparten el SELECT previo para distinguir
  // 404/409 y decidir el camino.
  if (parsed.data.accion === "completar") {
    return completarCita(supabase, ctx, id, parsed.data, req);
  }

  // no_show: transición de una sola tabla sin RPC (no hay invariante cruzada
  // que proteger). SELECT previo distingue 404 de 409.
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
      { error: `No se puede marcar como no_show una cita en estado ${existing.estado}` },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("citas")
    .update({ estado: "no_show" })
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
    newValues: { estado: "no_show" },
    changeDescription: "Cita marcada como no_show",
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json(data);
}, { endpoint: "PATCH /api/citas/id" });

// Acción "completar": camino legado (sin precio) vs. cobro con
// completar_cita_tx. Lógica de dinero aislada del resto del PATCH.
async function completarCita(
  supabase: ReturnType<typeof createServiceClient>,
  ctx: NonNullable<Awaited<ReturnType<typeof getStoreId>>>,
  id: string,
  body: PagoLegado & { pagos?: PagoInput[] },
  req: NextRequest
) {
  const { data: existing } = await supabase
    .from("citas")
    .select("id, estado, precio, cliente_id")
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .single();
  if (!existing) {
    return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
  }
  if (existing.estado !== "confirmada") {
    return NextResponse.json(
      { error: `No se puede marcar como completada una cita en estado ${existing.estado}` },
      { status: 409 }
    );
  }

  // ── Camino legado: cita sin precio (pre-migración 068) → completar sin
  //    cobro, exactamente como antes. No se exige ni se usa el body de pago.
  if (existing.precio == null) {
    const { data, error } = await supabase
      .from("citas")
      .update({ estado: "completada" })
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
      newValues: { estado: "completada" },
      changeDescription: "Cita marcada como completada (legado, sin cobro)",
      ipAddress,
      userAgent,
    }).catch(() => {});

    return NextResponse.json(data);
  }

  // ── Cita con precio: el cobro es obligatorio (pagos[] o el formato
  //    anterior: método único, resto de una NC o NC total).
  if (!body.pagos && !body.metodoPago) {
    return NextResponse.json({ error: "Debes indicar un método de pago para completar esta cita" }, { status: 400 });
  }

  const total = Number(existing.precio);
  const impuesto = extraerIva(total); // AGENTS.md §23.3 — solo esta fórmula

  // Hallazgo de revisión: el monto de NC no puede exceder lo que realmente se
  // está cobrando (el total de la cita) — evita consumir crédito de más. Con
  // pagos[] lo cubre la suma exacta; validar_pagos lo repite en la RPC.
  if (body.pagoNc && body.pagoNc.monto > total) {
    return NextResponse.json({ error: "El monto de la NC no puede exceder el total a cobrar" }, { status: 400 });
  }

  // Mismas reglas que POST /api/ventas: lista única validada contra el precio
  // de la cita (servidor), nunca contra un total enviado por el cliente.
  const pagos = normalizarPagos(body, total);
  const errorPagos = validarPagos(pagos, total, existing.cliente_id);
  if (errorPagos) return NextResponse.json({ error: errorPagos }, { status: 400 });

  const pagoNc = pagos.find((p) => p.metodo === "nota_credito");
  if (pagoNc) {
    const nc = await prevalidarNotaCredito(supabase, ctx.storeId, pagoNc.notaCreditoId as string, pagoNc.monto);
    if (!nc.ok) return NextResponse.json({ error: nc.error }, { status: nc.status });
  }

  // Niveles de fidelización — mismo fetch + default que postVenta().
  const { data: storeConfig } = await supabase
    .from("stores")
    .select("fidelizacion_niveles")
    .eq("id", ctx.storeId)
    .single();
  const fidelizacionNiveles = (storeConfig?.fidelizacion_niveles as { monto: number; descuento: number }[] | null) ?? [
    { monto: 50000, descuento: 5 },
    { monto: 150000, descuento: 10 },
    { monto: 300000, descuento: 20 },
  ];

  // ── Cobro atómico: completar_cita_tx (migración 068 §3d) ──────────────────
  const { data: result, error: txError } = await supabase.rpc("completar_cita_tx", {
    p_cita_id: id,
    p_store_id: ctx.storeId,
    // Parámetros antiguos de pago en NULL: la RPC usa p_pagos (093).
    p_metodo_pago: null,
    p_numero_transaccion: null,
    p_impuesto: impuesto,
    p_pago_nc: null,
    p_fidelizacion_niveles: fidelizacionNiveles,
    p_completado_por: ctx.userId,
    p_pagos: pagosParaRpc(pagos),
  });

  if (txError) {
    if (txError.code === "P0002") {
      return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
    }
    if (txError.code === "PS003") {
      return NextResponse.json({ error: txError.message }, { status: 409 });
    }
    if (txError.code === "PS005") {
      // Cita legado sin precio que llegó a la ruta con precio — no debería
      // ocurrir (el camino legado filtra arriba), defensa en profundidad.
      return NextResponse.json({ error: txError.message }, { status: 400 });
    }
    // Errores del cobro (validar_pagos / aplicar_pagos, migración 093): NC
    // reclamada por otra operación concurrente (PV003, 409 — conflicto real,
    // no error del servidor), suma inválida (PV001), saldo insuficiente, etc.
    const estadoPago = estadoHttpErrorPago(txError.code);
    if (estadoPago) {
      return NextResponse.json({ error: txError.message }, { status: estadoPago });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { cita, venta } = result as { cita: { id: string; venta_id?: string }; venta: Record<string, unknown> };
  // Etiqueta decidida por la RPC (validar_pagos): método único o 'mixto'.
  const metodoPagoVenta = venta.metodo_pago as string;

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: ctx.storeId,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "cita",
    entityId: id,
    newValues: { estado: "completada", venta_id: venta.id, total, metodoPago: metodoPagoVenta },
    changeDescription: `Cita completada y cobrada por $${total}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  // Asiento contable post-response con after() (mismo patrón que postVenta:
  // un fire-and-forget puro puede congelarse en serverless y perder el asiento,
  // ticket Trello 6a77e779358cdccca29dc3e3): acredita VENTAS_SERVICIOS. NO incluye COGS (servicio sin
  // costo de inventario). Una línea de cobro por pago: el crédito interno (NC,
  // saldo a favor) debita Saldos a Favor, nunca Caja/Banco.
  const fechaVenta = venta.created_at ? fechaNegocioDeTimestamp(venta.created_at as string) : hoyNegocioISO();
  const montoNeto = total - impuesto;
  after(async () => {
    try {
      const asiento = await crearAsiento({
        storeId: ctx.storeId,
        fecha: fechaVenta,
        tipoMovimiento: "VENTA",
        canal: "pos",
        referenciaId: venta.id as string,
        referenciaNomero: venta.numero_comprobante as string,
        descripcion: `Cobro cita (servicio)${metodoPagoVenta !== "nota_credito" && metodoPagoVenta !== "mixto" ? ` ${metodoPagoVenta}` : ""}`,
        lineas: lineasVentaPagos({ pagos, montoNeto, iva: impuesto, cuentaIngreso: "VENTAS_SERVICIOS" }),
        usuarioId: ctx.userId ?? undefined,
      });
      if (!asiento) console.error(`[contabilidad] Asiento de cobro de cita NO CREADO para cita ${id} (venta ${venta.id})`);
    } catch (e) {
      console.error("[contabilidad] Error en asiento de cobro de cita:", e);
    }
  });

  return NextResponse.json(cita);
}
