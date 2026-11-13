// Dominio del cobro de una venta o cita con uno o varios medios de pago
// (pago mixto). Puro: lo usan la API, la UI del POS/citas y los reportes, así
// que no importa nada de servidor. La autoridad final es la RPC
// (validar_pagos / aplicar_pagos, migración 093); esto es la misma regla en
// TypeScript para fallar temprano y para calcular el monto a boletear.
// Diseño y fundamento fiscal: docs/pago_complementario.md, docs/plan_pago_mixto.md.

export const METODOS_PAGO = [
  "efectivo",
  "debito",
  "credito",
  "transferencia",
  "nota_credito",
  "saldo_a_favor",
] as const;

export type MetodoPago = (typeof METODOS_PAGO)[number];

// Exigen número de transacción (voucher Transbank o comprobante de transferencia).
export const METODOS_CON_TRX: ReadonlySet<string> = new Set(["debito", "credito", "transferencia"]);

// Pagos con tarjeta: el voucher Transbank vale como boleta (Res. Ex. SII 176/2020).
export const METODOS_TARJETA: ReadonlySet<string> = new Set(["debito", "credito"]);

// Crédito interno de la tienda: no entra dinero, se consume un pasivo.
export const METODOS_CREDITO_INTERNO: ReadonlySet<string> = new Set(["nota_credito", "saldo_a_favor"]);

export const MAX_PAGOS = 5;

export const ETIQUETA_METODO: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  nota_credito: "Nota de crédito",
  saldo_a_favor: "Saldo a favor",
  saldo_favor: "Saldo a favor",
  plataforma: "Plataforma",
  mixto: "Mixto",
};

export function etiquetaMetodo(metodo: string): string {
  return ETIQUETA_METODO[metodo] ?? metodo;
}

export interface PagoInput {
  metodo: MetodoPago;
  monto: number;
  numeroTransaccion?: string;
  notaCreditoId?: string;
}

// Formato legado del body: un método + NC opcional. Se sigue aceptando para no
// romper callers, pero se convierte a pagos[] aquí y solo aquí.
export interface PagoLegado {
  metodoPago?: string;
  numeroTransaccion?: string;
  pagoNc?: { nota_credito_id: string; numero_nc: string; monto: number };
}

export function normalizarPagos(
  input: PagoLegado & { pagos?: PagoInput[] },
  total: number
): PagoInput[] {
  if (input.pagos) return input.pagos;

  const trx = input.numeroTransaccion?.trim() || undefined;
  if (!input.pagoNc) {
    return [{ metodo: input.metodoPago as MetodoPago, monto: total, numeroTransaccion: trx }];
  }

  const montoNc = Math.round(input.pagoNc.monto);
  const pagos: PagoInput[] = [
    { metodo: "nota_credito", monto: montoNc, notaCreditoId: input.pagoNc.nota_credito_id },
  ];
  const resto = total - montoNc;
  if (resto > 0) {
    pagos.push({ metodo: input.metodoPago as MetodoPago, monto: resto, numeroTransaccion: trx });
  }
  return pagos;
}

// Reglas de forma de la lista, sin total ni cliente (las usa el schema Zod).
// Devuelve el primer error legible o null.
export function validarFormaPagos(pagos: PagoInput[]): string | null {
  if (pagos.length === 0) return "Debe indicar al menos un medio de pago";
  if (pagos.length > MAX_PAGOS) return `Máximo ${MAX_PAGOS} medios de pago por venta`;

  for (const p of pagos) {
    if (!(METODOS_PAGO as readonly string[]).includes(p.metodo)) return `Método de pago no permitido: ${p.metodo}`;
    // $0 solo como pago único de una venta de $0 (100 % de descuento, I-50);
    // la suma exacta contra el total lo garantiza. Nunca con crédito interno:
    // una NC por $0 quedaría "usada" sin pagar nada.
    if (
      !Number.isInteger(p.monto) || p.monto < 0 ||
      (p.monto === 0 && (pagos.length > 1 || METODOS_CREDITO_INTERNO.has(p.metodo)))
    ) {
      return "Cada monto debe ser un entero mayor a 0";
    }
    if (METODOS_CON_TRX.has(p.metodo) && !p.numeroTransaccion?.trim()) {
      return `El número de transacción es obligatorio para ${etiquetaMetodo(p.metodo).toLowerCase()}`;
    }
    if (p.metodo === "nota_credito" && !p.notaCreditoId) return "Falta la nota de crédito del pago";
    if (p.metodo !== "nota_credito" && p.notaCreditoId) return "Solo un pago con nota de crédito puede indicar una NC";
  }

  const nNc = pagos.filter((p) => p.metodo === "nota_credito").length;
  const nSaldo = pagos.filter((p) => p.metodo === "saldo_a_favor").length;
  if (nNc > 1) return "Solo se puede usar una nota de crédito por venta";
  if (nSaldo > 1) return "Solo se puede usar el saldo a favor una vez por venta";
  // Una NC tipo saldo_a_favor y el saldo del cliente son el mismo dinero
  // (decisión D8 del plan): combinarlos en una venta abre un doble consumo.
  if (nNc > 0 && nSaldo > 0) return "No se puede combinar nota de crédito y saldo a favor en la misma venta";
  // Cada medio una sola vez: dos pagos en efectivo (o con débito) son uno solo.
  const repetido = pagos.find((p, i) => pagos.findIndex((q) => q.metodo === p.metodo) !== i);
  if (repetido) return `No se puede repetir el medio de pago: ${etiquetaMetodo(repetido.metodo).toLowerCase()}`;
  return null;
}

// Reglas completas que no dependen de la BD. La suma se valida contra el total
// que calcula el servidor, nunca contra uno enviado por el cliente.
export function validarPagos(pagos: PagoInput[], total: number, clienteId?: string | null): string | null {
  const errorForma = validarFormaPagos(pagos);
  if (errorForma) return errorForma;
  if (pagos.some((p) => p.metodo === "saldo_a_favor") && !clienteId) {
    return "El saldo a favor requiere un cliente asociado a la venta";
  }
  // Toda NC es de un cliente y solo él la usa (decisión 2026-11-12).
  if (pagos.some((p) => p.metodo === "nota_credito") && !clienteId) {
    return "La nota de crédito solo la puede usar su dueño: seleccione el cliente de la venta";
  }

  const suma = pagos.reduce((s, p) => s + p.monto, 0);
  if (suma !== total) {
    return `La suma de los pagos ($${suma.toLocaleString("es-CL")}) no coincide con el total ($${total.toLocaleString("es-CL")})`;
  }
  return null;
}

// Errores del cobro que lanzan validar_pagos/aplicar_pagos (migración 093) con
// ERRCODE estable → estado HTTP. null = no es un error de pagos.
const HTTP_ERROR_PAGO: Record<string, number> = {
  PV001: 400, // pagos inválidos
  PV002: 404, // NC no encontrada (u otra tienda)
  PV003: 409, // NC ya usada / carrera
  PV004: 410, // NC vencida
  PV005: 409, // NC con reembolso directo
  PV006: 409, // saldo a favor insuficiente
  PV007: 400, // saldo a favor sin cliente
  PV008: 409, // NC de otro cliente o sin dueño
  PV009: 400, // NC sin cliente al crearla / cliente inválido
};

export function estadoHttpErrorPago(code: string | undefined | null): number | null {
  return (code && HTTP_ERROR_PAGO[code]) || null;
}

// Parámetro p_pagos de las RPC (jsonb, snake_case).
export function pagosParaRpc(pagos: PagoInput[]) {
  return pagos.map((p) => ({
    metodo: p.metodo,
    monto: p.monto,
    numero_transaccion: p.numeroTransaccion?.trim() || null,
    nota_credito_id: p.notaCreditoId ?? null,
  }));
}

// Monto que la tienda debe boletear (Res. Ex. SII 176/2020, resolutivo 2°): todo
// lo que no se pagó con tarjeta, porque el voucher Transbank solo cubre esa parte.
// Incluye NC y saldo a favor (crédito interno: no es medio electrónico).
export function calcularMontoBoleta(pagos: { metodo: string; monto: number | string }[]): number {
  return Math.round(
    pagos.filter((p) => !METODOS_TARJETA.has(p.metodo)).reduce((s, p) => s + Number(p.monto), 0)
  );
}

// Desglose del monto a boletear por método (para el aviso al cajero).
export function desgloseBoleta(pagos: { metodo: string; monto: number | string }[]): { metodo: string; monto: number }[] {
  const porMetodo = new Map<string, number>();
  for (const p of pagos) {
    if (METODOS_TARJETA.has(p.metodo)) continue;
    porMetodo.set(p.metodo, (porMetodo.get(p.metodo) ?? 0) + Number(p.monto));
  }
  return [...porMetodo].map(([metodo, monto]) => ({ metodo, monto: Math.round(monto) }));
}
