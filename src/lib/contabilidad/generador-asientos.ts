import { createServiceClient } from "@/lib/supabase";
import { extraerIva } from "@/lib/tax";
import type { CrearAsientoInput, LineaAsiento, TipoMovimiento } from "./types";
import { CUENTAS } from "./types";

async function nextNumeroAsiento(supabase: ReturnType<typeof createServiceClient>, storeId: string): Promise<number> {
  const { data } = await supabase
    .from("journal_entries")
    .select("numero_asiento")
    .eq("store_id", storeId)
    .order("numero_asiento", { ascending: false })
    .limit(1)
    .single();
  return (data?.numero_asiento ?? 0) + 1;
}

// Código de error Postgres para violación de constraint UNIQUE
const UNIQUE_VIOLATION = "23505";
const MAX_NUMERO_ASIENTO_RETRIES = 5;
const MAX_DETALLE_RETRIES = 3;

// nextNumeroAsiento() hace lectura-luego-escritura sin lock: dos crearAsiento()
// concurrentes para la misma tienda (ej. pago múltiple de cuentas por pagar,
// que dispara un PATCH por cuenta en paralelo) pueden calcular el mismo
// numero_asiento y chocar contra el UNIQUE(store_id, numero_asiento). En vez
// de perder el asiento perdedor de la carrera, se reintenta con un número
// recién calculado — igual al patrón estándar de "insert optimista + retry
// en conflicto" para contadores sin secuencia dedicada.
async function insertJournalEntryConNumeroUnico(
  supabase: ReturnType<typeof createServiceClient>,
  input: CrearAsientoInput,
  td: number,
  tc: number,
  balanceado: boolean
): Promise<{ id: string } | null> {
  for (let intento = 0; intento < MAX_NUMERO_ASIENTO_RETRIES; intento++) {
    const numero = await nextNumeroAsiento(supabase, input.storeId);

    const { data: entry, error: entryErr } = await supabase
      .from("journal_entries")
      .insert({
        store_id: input.storeId,
        numero_asiento: numero,
        fecha: input.fecha,
        tipo_movimiento: input.tipoMovimiento ?? null,
        canal: input.canal ?? "pos",
        referencia_id: input.referenciaId ?? null,
        referencia_numero: input.referenciaNomero ?? null,
        descripcion: input.descripcion,
        total_debito: td,
        total_credito: tc,
        esta_balanceado: balanceado,
        usuario_id: input.usuarioId ?? null,
        creado_por: input.creadoPor ?? null,
      })
      .select("id")
      .single();

    if (!entryErr && entry) return entry;

    if (entryErr?.code !== UNIQUE_VIOLATION) {
      console.error("[contabilidad] Error creando journal_entry:", entryErr?.message);
      return null;
    }
    // Colisión de numero_asiento por carrera — reintentar con número recalculado
  }

  console.error(`[contabilidad] No se pudo generar numero_asiento único tras ${MAX_NUMERO_ASIENTO_RETRIES} intentos | ${input.descripcion}`);
  return null;
}

export async function crearAsiento(input: CrearAsientoInput): Promise<string | null> {
  const supabase = createServiceClient();

  const totalDebito = input.lineas.reduce((s, l) => s + (l.debito ?? 0), 0);
  const totalCredito = input.lineas.reduce((s, l) => s + (l.credito ?? 0), 0);

  // Round to avoid floating point drift
  const td = Math.round(totalDebito);
  const tc = Math.round(totalCredito);
  const balanceado = td === tc;

  if (!balanceado) {
    console.error(`[contabilidad] Asiento desbalanceado: débito=${td} crédito=${tc} | ${input.descripcion}`);
    return null;
  }

  // Un asiento balanceado con $0/$0 no tiene movimiento económico — rechazar.
  // Protege contra lineasPagoProveedor(0) y similares.
  if (td === 0) {
    console.error(`[contabilidad] Asiento rechazado: monto cero | ${input.descripcion}`);
    return null;
  }

  // Validar que el período contable no esté cerrado. Una vez que existe un
  // CIERRE_MES para un período, ningún movimiento NUEVO debe poder
  // registrarse con fecha dentro de ese período (ticket Trello
  // 6a61a41b75e6c54191f0c2c2). Tres excepciones deliberadas, no son "nuevo
  // negocio" sino correcciones de algo que ya ocurrió en ese período:
  // - CIERRE_MES: el propio asiento que cierra el período — de lo contrario
  //   nunca podría crearse.
  // - ANULACION_VENTA: su fecha es deliberadamente la de la venta original
  //   (no la de hoy, ver comentario en ventas/[id]/route.ts) para que el
  //   reverso caiga en el mismo período que el asiento que anula. Bloquearlo
  //   dejaría anular_venta_tx (que no tiene guard de período) reversando
  //   stock/fidelización/saldo con total normalidad mientras el Libro Diario
  //   nunca refleja la anulación — el ingreso original queda contabilizado
  //   para siempre sin su reverso.
  // - creadoPor==="backfill": POST /api/contabilidad/backfill es el
  //   mecanismo documentado (AGENTS.md §10.1) para reconciliar asientos que
  //   se perdieron por una falla transitoria en un período que puede haberse
  //   cerrado desde entonces — bloquearlo inutilizaría esa reconciliación
  //   para cualquier período ya cerrado.
  if (
    input.tipoMovimiento !== "CIERRE_MES" &&
    input.tipoMovimiento !== "ANULACION_VENTA" &&
    input.creadoPor !== "backfill"
  ) {
    const periodo = input.fecha.substring(0, 7);
    const { data: cierre } = await supabase
      .from("journal_entries")
      .select("id")
      .eq("store_id", input.storeId)
      .eq("tipo_movimiento", "CIERRE_MES")
      .eq("referencia_numero", periodo)
      .limit(1);

    if (cierre && cierre.length > 0) {
      console.error(
        `[contabilidad] Período ${periodo} ya cerrado — se rechaza asiento | ${input.descripcion}`
      );
      return null;
    }
  }

  // El insert de journal_detail puede fallar por razones transitorias (timeout,
  // colisión de conexión, staleness del schema cache de PostgREST — ver commit
  // 24cfb1a) independientes de la colisión de numero_asiento que ya reintenta
  // insertJournalEntryConNumeroUnico. Sin este reintento externo, un fallo aquí
  // borra el asiento recién creado (rollback) y lo pierde para siempre en el
  // primer intento — causa raíz confirmada de "venta con asiento COGS pero sin
  // asiento de ingreso" (venta real 20260707-9CE8F125, verificado contra
  // producción: sin numero_asiento en colisión, sin venta concurrente — el
  // asiento de ingreso simplemente nunca tuvo una segunda oportunidad).
  for (let intento = 0; intento < MAX_DETALLE_RETRIES; intento++) {
    const entry = await insertJournalEntryConNumeroUnico(supabase, input, td, tc, balanceado);
    if (!entry) return null;

    const detalles = input.lineas.map((l, i) => ({
      journal_entry_id: entry.id,
      numero_linea: i + 1,
      cuenta_codigo: l.cuentaCodigo,
      cuenta_nombre: l.cuentaNombre,
      cuenta_tipo: l.cuentaTipo ?? null,
      debito: l.debito ?? 0,
      credito: l.credito ?? 0,
      descripcion_linea: l.descripcionLinea ?? null,
    }));

    const { error: detErr } = await supabase.from("journal_detail").insert(detalles);

    if (!detErr) return entry.id;

    console.error(
      `[contabilidad] Error creando journal_detail (intento ${intento + 1}/${MAX_DETALLE_RETRIES}):`,
      detErr.message
    );

    // Rollback del asiento recién creado. El resultado del delete NO se puede
    // ignorar: si el delete falla (timeout, staleness del schema cache — las
    // mismas causas transitorias que pueden haber derribado el insert del
    // detalle), el asiento queda huérfano en journal_entries SIN filas en
    // journal_detail. Ese huérfano es invisible para el Estado de Resultado
    // (su fallback suma solo detalles existentes) y para el backfill (busca
    // asientos faltantes por tipo_movimiento+referencia_id, y el huérfano
    // "existe"), por lo que el COGS de la venta/NC/OC asociada se pierde
    // silenciosamente (ticket Trello 6a77e779e5698ef7e7e3afda — asiento #209
    // huérfano sin detalle en producción). Al menos debe quedar en el log.
    const { error: rollbackErr } = await supabase.from("journal_entries").delete().eq("id", entry.id);
    if (rollbackErr) {
      console.error(
        `[contabilidad] Rollback fallido: journal_entry ${entry.id} quedó huérfano tras error de journal_detail | ${input.descripcion}`,
        rollbackErr.message
      );
    }
  }

  console.error(`[contabilidad] No se pudo crear el detalle del asiento tras ${MAX_DETALLE_RETRIES} intentos | ${input.descripcion}`);
  return null;
}

// ─────────────────────────────────────────────────────────
// Builders por tipo de movimiento
// ─────────────────────────────────────────────────────────

export function lineasVenta(params: {
  metodoPago: string;
  montoNeto: number;
  iva: number;
  total: number;
}): LineaAsiento[] {
  const cuentaCaja = params.metodoPago === "efectivo" ? CUENTAS.CAJA : CUENTAS.BANCO;

  return [
    {
      cuentaCodigo: cuentaCaja.codigo,
      cuentaNombre: cuentaCaja.nombre,
      cuentaTipo: cuentaCaja.tipo,
      debito: params.total,
      credito: 0,
      descripcionLinea: "Cobro venta",
    },
    {
      cuentaCodigo: CUENTAS.IVA_PAGAR.codigo,
      cuentaNombre: CUENTAS.IVA_PAGAR.nombre,
      cuentaTipo: CUENTAS.IVA_PAGAR.tipo,
      debito: 0,
      credito: params.iva,
      descripcionLinea: "IVA 19%",
    },
    {
      cuentaCodigo: CUENTAS.VENTAS.codigo,
      cuentaNombre: CUENTAS.VENTAS.nombre,
      cuentaTipo: CUENTAS.VENTAS.tipo,
      debito: 0,
      credito: params.montoNeto,
      descripcionLinea: "Ingreso por venta",
    },
  ];
}

export function lineasVentaCanal(params: {
  canal: string;
  metodoPago: string;
  montoNeto: number;
  iva: number;
  total: number;
}): LineaAsiento[] {
  let cuentaCodigo: string;
  let cuentaNombre: string;
  let cuentaTipo: string;

  if (params.canal === "rappi") {
    cuentaCodigo = CUENTAS.CXC_RAPPI.codigo;
    cuentaNombre = CUENTAS.CXC_RAPPI.nombre;
    cuentaTipo = CUENTAS.CXC_RAPPI.tipo;
  } else if (params.canal === "pedidosya") {
    cuentaCodigo = CUENTAS.CXC_PEDIDOSYA.codigo;
    cuentaNombre = CUENTAS.CXC_PEDIDOSYA.nombre;
    cuentaTipo = CUENTAS.CXC_PEDIDOSYA.tipo;
  } else if (params.canal === "ubereats") {
    cuentaCodigo = CUENTAS.CXC_UBEREATS.codigo;
    cuentaNombre = CUENTAS.CXC_UBEREATS.nombre;
    cuentaTipo = CUENTAS.CXC_UBEREATS.tipo;
  } else {
    const caja = params.metodoPago === "efectivo" ? CUENTAS.CAJA : CUENTAS.BANCO;
    cuentaCodigo = caja.codigo;
    cuentaNombre = caja.nombre;
    cuentaTipo = caja.tipo;
  }

  return [
    {
      cuentaCodigo,
      cuentaNombre,
      cuentaTipo,
      debito: params.total,
      credito: 0,
      descripcionLinea: `Cobro ${params.canal}`,
    },
    {
      cuentaCodigo: CUENTAS.IVA_PAGAR.codigo,
      cuentaNombre: CUENTAS.IVA_PAGAR.nombre,
      cuentaTipo: CUENTAS.IVA_PAGAR.tipo,
      debito: 0,
      credito: params.iva,
      descripcionLinea: "IVA 19%",
    },
    {
      cuentaCodigo: CUENTAS.VENTAS.codigo,
      cuentaNombre: CUENTAS.VENTAS.nombre,
      cuentaTipo: CUENTAS.VENTAS.tipo,
      debito: 0,
      credito: params.montoNeto,
      descripcionLinea: "Ingreso por venta",
    },
  ];
}

export function lineasVentaConNc(params: {
  montoNeto: number;
  iva: number;
  total: number;
  montoNc: number;
  montoResto: number;
  metodoPagoResto?: string;
}): LineaAsiento[] {
  const lineas: LineaAsiento[] = [];

  lineas.push({
    cuentaCodigo: CUENTAS.SALDOS_FAVOR.codigo,
    cuentaNombre: CUENTAS.SALDOS_FAVOR.nombre,
    cuentaTipo: CUENTAS.SALDOS_FAVOR.tipo,
    debito: params.montoNc,
    credito: 0,
    descripcionLinea: "Pago con Nota de Crédito",
  });

  if (params.montoResto > 0) {
    const cuentaCaja = params.metodoPagoResto === "efectivo" ? CUENTAS.CAJA : CUENTAS.BANCO;
    lineas.push({
      cuentaCodigo: cuentaCaja.codigo,
      cuentaNombre: cuentaCaja.nombre,
      cuentaTipo: cuentaCaja.tipo,
      debito: params.montoResto,
      credito: 0,
      descripcionLinea: "Cobro diferencia venta",
    });
  }

  lineas.push({
    cuentaCodigo: CUENTAS.IVA_PAGAR.codigo,
    cuentaNombre: CUENTAS.IVA_PAGAR.nombre,
    cuentaTipo: CUENTAS.IVA_PAGAR.tipo,
    debito: 0,
    credito: params.iva,
    descripcionLinea: "IVA 19%",
  });

  lineas.push({
    cuentaCodigo: CUENTAS.VENTAS.codigo,
    cuentaNombre: CUENTAS.VENTAS.nombre,
    cuentaTipo: CUENTAS.VENTAS.tipo,
    debito: 0,
    credito: params.montoNeto,
    descripcionLinea: "Ingreso por venta",
  });

  return lineas;
}

// Asiento de ingreso del cobro de una cita completada (servicio). Espejo de
// lineasVenta pero acreditando VENTAS_SERVICIOS (410103) en vez de VENTAS —
// separa la línea de negocio de servicios en el Estado de Resultado (Fase 4).
export function lineasVentaServicio(params: {
  metodoPago: string;
  montoNeto: number;
  iva: number;
  total: number;
}): LineaAsiento[] {
  const cuentaCaja = params.metodoPago === "efectivo" ? CUENTAS.CAJA : CUENTAS.BANCO;

  return [
    {
      cuentaCodigo: cuentaCaja.codigo,
      cuentaNombre: cuentaCaja.nombre,
      cuentaTipo: cuentaCaja.tipo,
      debito: params.total,
      credito: 0,
      descripcionLinea: "Cobro cita (servicio)",
    },
    {
      cuentaCodigo: CUENTAS.IVA_PAGAR.codigo,
      cuentaNombre: CUENTAS.IVA_PAGAR.nombre,
      cuentaTipo: CUENTAS.IVA_PAGAR.tipo,
      debito: 0,
      credito: params.iva,
      descripcionLinea: "IVA 19%",
    },
    {
      cuentaCodigo: CUENTAS.VENTAS_SERVICIOS.codigo,
      cuentaNombre: CUENTAS.VENTAS_SERVICIOS.nombre,
      cuentaTipo: CUENTAS.VENTAS_SERVICIOS.tipo,
      debito: 0,
      credito: params.montoNeto,
      descripcionLinea: "Ingreso por servicio",
    },
  ];
}

// Asiento del cobro de cita pagada total o parcialmente con nota de crédito.
// Espejo de lineasVentaConNc acreditando VENTAS_SERVICIOS (410103).
export function lineasVentaServicioConNc(params: {
  montoNeto: number;
  iva: number;
  total: number;
  montoNc: number;
  montoResto: number;
  metodoPagoResto?: string;
}): LineaAsiento[] {
  const lineas: LineaAsiento[] = [];

  lineas.push({
    cuentaCodigo: CUENTAS.SALDOS_FAVOR.codigo,
    cuentaNombre: CUENTAS.SALDOS_FAVOR.nombre,
    cuentaTipo: CUENTAS.SALDOS_FAVOR.tipo,
    debito: params.montoNc,
    credito: 0,
    descripcionLinea: "Pago con Nota de Crédito",
  });

  if (params.montoResto > 0) {
    const cuentaCaja = params.metodoPagoResto === "efectivo" ? CUENTAS.CAJA : CUENTAS.BANCO;
    lineas.push({
      cuentaCodigo: cuentaCaja.codigo,
      cuentaNombre: cuentaCaja.nombre,
      cuentaTipo: cuentaCaja.tipo,
      debito: params.montoResto,
      credito: 0,
      descripcionLinea: "Cobro diferencia cita",
    });
  }

  lineas.push({
    cuentaCodigo: CUENTAS.IVA_PAGAR.codigo,
    cuentaNombre: CUENTAS.IVA_PAGAR.nombre,
    cuentaTipo: CUENTAS.IVA_PAGAR.tipo,
    debito: 0,
    credito: params.iva,
    descripcionLinea: "IVA 19%",
  });

  lineas.push({
    cuentaCodigo: CUENTAS.VENTAS_SERVICIOS.codigo,
    cuentaNombre: CUENTAS.VENTAS_SERVICIOS.nombre,
    cuentaTipo: CUENTAS.VENTAS_SERVICIOS.tipo,
    debito: 0,
    credito: params.montoNeto,
    descripcionLinea: "Ingreso por servicio",
  });

  return lineas;
}

export function lineasNotaCredito(params: {
  monto: number;         // total con IVA incluido
  tipoReembolso: string;
  metodoReembolso?: string;
}): LineaAsiento[] {
  const ivaDevuelto = extraerIva(params.monto);
  const montoNeto = params.monto - ivaDevuelto;

  let cuentaCredito;
  if (params.tipoReembolso === "saldo_a_favor") {
    cuentaCredito = CUENTAS.SALDOS_FAVOR;
  } else if (params.metodoReembolso === "efectivo") {
    cuentaCredito = CUENTAS.CAJA;
  } else {
    cuentaCredito = CUENTAS.BANCO;
  }

  return [
    {
      cuentaCodigo: CUENTAS.DEVOLUCIONES.codigo,
      cuentaNombre: CUENTAS.DEVOLUCIONES.nombre,
      cuentaTipo: CUENTAS.DEVOLUCIONES.tipo,
      debito: montoNeto,
      credito: 0,
      descripcionLinea: "Devolución de venta (neto)",
    },
    {
      cuentaCodigo: CUENTAS.IVA_PAGAR.codigo,
      cuentaNombre: CUENTAS.IVA_PAGAR.nombre,
      cuentaTipo: CUENTAS.IVA_PAGAR.tipo,
      debito: ivaDevuelto,
      credito: 0,
      descripcionLinea: "Reverso IVA débito fiscal",
    },
    {
      cuentaCodigo: cuentaCredito.codigo,
      cuentaNombre: cuentaCredito.nombre,
      cuentaTipo: cuentaCredito.tipo,
      debito: 0,
      credito: params.monto,
      descripcionLinea:
        params.tipoReembolso === "saldo_a_favor"
          ? "Saldo a favor cliente"
          : "Reembolso a cliente",
    },
  ];
}

// Reverso de COGS por devolución (nota de crédito con restitución de stock).
// Misma forma que lineasAnulacionCOGS (Dr Inventario / Cr COGS) — se separa
// por descripcionLinea para distinguir el origen en el Libro Diario, igual
// que lineasVentaCOGS/lineasAnulacionCOGS/lineasCierreCOGS ya lo hacen entre sí.
export function lineasNotaCreditoCOGS(costoTotal: number): LineaAsiento[] {
  return [
    {
      cuentaCodigo: CUENTAS.INVENTARIO.codigo,
      cuentaNombre: CUENTAS.INVENTARIO.nombre,
      cuentaTipo: CUENTAS.INVENTARIO.tipo,
      debito: costoTotal,
      credito: 0,
      descripcionLinea: "Reincorporación inventario por devolución",
    },
    {
      cuentaCodigo: CUENTAS.COGS.codigo,
      cuentaNombre: CUENTAS.COGS.nombre,
      cuentaTipo: CUENTAS.COGS.tipo,
      debito: 0,
      credito: costoTotal,
      descripcionLinea: "Reverso COGS por devolución",
    },
  ];
}

export function lineasCompra(params: {
  montoNeto: number;
  iva: number;
  total: number;
}): LineaAsiento[] {
  return [
    {
      cuentaCodigo: CUENTAS.INVENTARIO.codigo,
      cuentaNombre: CUENTAS.INVENTARIO.nombre,
      cuentaTipo: CUENTAS.INVENTARIO.tipo,
      debito: params.montoNeto,
      credito: 0,
      descripcionLinea: "Compra inventario",
    },
    {
      cuentaCodigo: CUENTAS.IVA_CREDITO_FISCAL.codigo,
      cuentaNombre: CUENTAS.IVA_CREDITO_FISCAL.nombre,
      cuentaTipo: CUENTAS.IVA_CREDITO_FISCAL.tipo,
      debito: params.iva,
      credito: 0,
      descripcionLinea: "IVA crédito fiscal compra",
    },
    {
      cuentaCodigo: CUENTAS.PROVEEDORES.codigo,
      cuentaNombre: CUENTAS.PROVEEDORES.nombre,
      cuentaTipo: CUENTAS.PROVEEDORES.tipo,
      debito: 0,
      credito: params.total,
      descripcionLinea: "Cuenta por pagar proveedor",
    },
  ];
}

export function lineasPagoProveedor(monto: number, metodoPago?: string): LineaAsiento[] {
  const cuenta = metodoPago === "efectivo" ? CUENTAS.CAJA : CUENTAS.BANCO;
  return [
    {
      cuentaCodigo: CUENTAS.PROVEEDORES.codigo,
      cuentaNombre: CUENTAS.PROVEEDORES.nombre,
      cuentaTipo: CUENTAS.PROVEEDORES.tipo,
      debito: monto,
      credito: 0,
      descripcionLinea: "Pago a proveedor",
    },
    {
      cuentaCodigo: cuenta.codigo,
      cuentaNombre: cuenta.nombre,
      cuentaTipo: cuenta.tipo,
      debito: 0,
      credito: monto,
      descripcionLinea: metodoPago === "efectivo" ? "Pago en efectivo" : "Pago desde banco",
    },
  ];
}

// Asiento de costo de venta por venta individual (perpetuo)
export function lineasVentaCOGS(costoTotal: number): LineaAsiento[] {
  return [
    {
      cuentaCodigo: CUENTAS.COGS.codigo,
      cuentaNombre: CUENTAS.COGS.nombre,
      cuentaTipo: CUENTAS.COGS.tipo,
      debito: costoTotal,
      credito: 0,
      descripcionLinea: "COGS venta del período",
    },
    {
      cuentaCodigo: CUENTAS.INVENTARIO.codigo,
      cuentaNombre: CUENTAS.INVENTARIO.nombre,
      cuentaTipo: CUENTAS.INVENTARIO.tipo,
      debito: 0,
      credito: costoTotal,
      descripcionLinea: "Reducción de inventario por venta",
    },
  ];
}

// Reverso de asiento de venta (anulación completa)
export function lineasAnulacionVentaCanal(params: {
  canal: string;
  metodoPago: string;
  montoNeto: number;
  iva: number;
  total: number;
}): LineaAsiento[] {
  let cuentaCodigo: string;
  let cuentaNombre: string;
  let cuentaTipo: string;

  if (params.canal === "rappi") {
    cuentaCodigo = CUENTAS.CXC_RAPPI.codigo;
    cuentaNombre = CUENTAS.CXC_RAPPI.nombre;
    cuentaTipo = CUENTAS.CXC_RAPPI.tipo;
  } else if (params.canal === "pedidosya") {
    cuentaCodigo = CUENTAS.CXC_PEDIDOSYA.codigo;
    cuentaNombre = CUENTAS.CXC_PEDIDOSYA.nombre;
    cuentaTipo = CUENTAS.CXC_PEDIDOSYA.tipo;
  } else if (params.canal === "ubereats") {
    cuentaCodigo = CUENTAS.CXC_UBEREATS.codigo;
    cuentaNombre = CUENTAS.CXC_UBEREATS.nombre;
    cuentaTipo = CUENTAS.CXC_UBEREATS.tipo;
  } else {
    const caja = params.metodoPago === "efectivo" ? CUENTAS.CAJA : CUENTAS.BANCO;
    cuentaCodigo = caja.codigo;
    cuentaNombre = caja.nombre;
    cuentaTipo = caja.tipo;
  }

  return [
    {
      cuentaCodigo: CUENTAS.VENTAS.codigo,
      cuentaNombre: CUENTAS.VENTAS.nombre,
      cuentaTipo: CUENTAS.VENTAS.tipo,
      debito: params.montoNeto,
      credito: 0,
      descripcionLinea: "Reverso ingreso por venta anulada",
    },
    {
      cuentaCodigo: CUENTAS.IVA_PAGAR.codigo,
      cuentaNombre: CUENTAS.IVA_PAGAR.nombre,
      cuentaTipo: CUENTAS.IVA_PAGAR.tipo,
      debito: params.iva,
      credito: 0,
      descripcionLinea: "Reverso IVA débito fiscal",
    },
    {
      cuentaCodigo,
      cuentaNombre,
      cuentaTipo,
      debito: 0,
      credito: params.total,
      descripcionLinea: "Reverso cobro venta anulada",
    },
  ];
}

// Reverso de asiento de venta pagada total o parcialmente con nota de
// crédito / saldo a favor (anulación completa). Espejo exacto de
// lineasVentaConNc: el crédito consumido se reacredita a Saldos a Favor
// (pasivo) — NUNCA a Caja/Banco, que no recibieron ese dinero — y solo el
// resto pagado en dinero revierte a Caja|Banco. Usar
// lineasAnulacionVentaCanal para estas ventas acredita el TOTAL a
// Caja|Banco: infla esas cuentas (puede llevarlas a saldo negativo, ticket
// Trello 6a5f9ad3fbf979e68251d40e) y deja el pasivo Saldos a Favor sin
// reacreditar.
export function lineasAnulacionVentaConNc(params: {
  montoNeto: number;
  iva: number;
  montoNc: number;
  montoResto: number;
  metodoPagoResto?: string;
}): LineaAsiento[] {
  const lineas: LineaAsiento[] = [];

  lineas.push({
    cuentaCodigo: CUENTAS.VENTAS.codigo,
    cuentaNombre: CUENTAS.VENTAS.nombre,
    cuentaTipo: CUENTAS.VENTAS.tipo,
    debito: params.montoNeto,
    credito: 0,
    descripcionLinea: "Reverso ingreso por venta anulada",
  });

  lineas.push({
    cuentaCodigo: CUENTAS.IVA_PAGAR.codigo,
    cuentaNombre: CUENTAS.IVA_PAGAR.nombre,
    cuentaTipo: CUENTAS.IVA_PAGAR.tipo,
    debito: params.iva,
    credito: 0,
    descripcionLinea: "Reverso IVA débito fiscal",
  });

  lineas.push({
    cuentaCodigo: CUENTAS.SALDOS_FAVOR.codigo,
    cuentaNombre: CUENTAS.SALDOS_FAVOR.nombre,
    cuentaTipo: CUENTAS.SALDOS_FAVOR.tipo,
    debito: 0,
    credito: params.montoNc,
    descripcionLinea: "Reacreditación de saldo a favor por anulación",
  });

  if (params.montoResto > 0) {
    const cuentaCaja = params.metodoPagoResto === "efectivo" ? CUENTAS.CAJA : CUENTAS.BANCO;
    lineas.push({
      cuentaCodigo: cuentaCaja.codigo,
      cuentaNombre: cuentaCaja.nombre,
      cuentaTipo: cuentaCaja.tipo,
      debito: 0,
      credito: params.montoResto,
      descripcionLinea: "Reverso cobro diferencia venta anulada",
    });
  }

  return lineas;
}

// Reverso de COGS (inventario reincorporado al stock por anulación de venta)
export function lineasAnulacionCOGS(costoTotal: number): LineaAsiento[] {
  return [
    {
      cuentaCodigo: CUENTAS.INVENTARIO.codigo,
      cuentaNombre: CUENTAS.INVENTARIO.nombre,
      cuentaTipo: CUENTAS.INVENTARIO.tipo,
      debito: costoTotal,
      credito: 0,
      descripcionLinea: "Reincorporación inventario por anulación",
    },
    {
      cuentaCodigo: CUENTAS.COGS.codigo,
      cuentaNombre: CUENTAS.COGS.nombre,
      cuentaTipo: CUENTAS.COGS.tipo,
      debito: 0,
      credito: costoTotal,
      descripcionLinea: "Reverso COGS por anulación de venta",
    },
  ];
}

// Aporte de capital de los socios/dueños hacia Caja o Banco. Dr la cuenta de
// activo que recibe el dinero, Cr Capital (patrimonio) — la contrapartida
// contable que faltaba para que un ingreso de dinero que NO es una venta
// pueda registrarse sin inflar cuentas de ingreso ni dejar la cuenta de
// destino con saldo negativo estructural (ticket Trello 6a61195cfc6f97edc3c0a3b0).
export function lineasAporteCapital(params: {
  cuentaDestino: "caja" | "banco";
  monto: number;
}): LineaAsiento[] {
  const cuenta = params.cuentaDestino === "caja" ? CUENTAS.CAJA : CUENTAS.BANCO;
  return [
    {
      cuentaCodigo: cuenta.codigo,
      cuentaNombre: cuenta.nombre,
      cuentaTipo: cuenta.tipo,
      debito: params.monto,
      credito: 0,
      descripcionLinea: "Aporte de capital recibido",
    },
    {
      cuentaCodigo: CUENTAS.CAPITAL.codigo,
      cuentaNombre: CUENTAS.CAPITAL.nombre,
      cuentaTipo: CUENTAS.CAPITAL.tipo,
      debito: 0,
      credito: params.monto,
      descripcionLinea: "Aporte de capital de socios",
    },
  ];
}

// Asiento de cierre: COGS = costo de ventas del mes
export function lineasCierreCOGS(costoTotal: number): LineaAsiento[] {
  return [
    {
      cuentaCodigo: CUENTAS.COGS.codigo,
      cuentaNombre: CUENTAS.COGS.nombre,
      cuentaTipo: CUENTAS.COGS.tipo,
      debito: costoTotal,
      credito: 0,
      descripcionLinea: "Costo de ventas del período",
    },
    {
      cuentaCodigo: CUENTAS.INVENTARIO.codigo,
      cuentaNombre: CUENTAS.INVENTARIO.nombre,
      cuentaTipo: CUENTAS.INVENTARIO.tipo,
      debito: 0,
      credito: costoTotal,
      descripcionLinea: "Reducción de inventario por ventas",
    },
  ];
}
