import { createServiceClient } from "@/lib/supabase";
import type { CrearAsientoInput, LineaAsiento, TipoMovimiento } from "./types";
import { CUENTAS } from "./types";

async function nextNumeroAsiento(storeId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("journal_entries")
    .select("numero_asiento")
    .eq("store_id", storeId)
    .order("numero_asiento", { ascending: false })
    .limit(1)
    .single();
  return (data?.numero_asiento ?? 0) + 1;
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
    console.error(`[contabilidad] Asiento desequilibrado: débito=${td} crédito=${tc} | ${input.descripcion}`);
    return null;
  }

  const numero = await nextNumeroAsiento(input.storeId);

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

  if (entryErr || !entry) {
    console.error("[contabilidad] Error creando journal_entry:", entryErr?.message);
    return null;
  }

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

  if (detErr) {
    console.error("[contabilidad] Error creando journal_detail:", detErr.message);
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    return null;
  }

  return entry.id;
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

export function lineasNotaCredito(params: {
  monto: number;         // total con IVA incluido
  tipoReembolso: string;
  metodoReembolso?: string;
}): LineaAsiento[] {
  const montoNeto = Math.round(params.monto / 1.19);
  const ivaDevuelto = params.monto - montoNeto;

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

export function lineasPagoProveedor(monto: number): LineaAsiento[] {
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
      cuentaCodigo: CUENTAS.BANCO.codigo,
      cuentaNombre: CUENTAS.BANCO.nombre,
      cuentaTipo: CUENTAS.BANCO.tipo,
      debito: 0,
      credito: monto,
      descripcionLinea: "Pago desde banco",
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
