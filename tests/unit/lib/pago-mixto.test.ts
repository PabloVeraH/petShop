/**
 * Pago mixto — dominio (src/lib/ventas/pagos.ts) y schemas Zod de venta/cita.
 * Plan: docs/plan_pago_mixto.md (F1). La RPC (migración 093) repite estas
 * reglas como autoridad final; aquí se prueba la capa de API/UI.
 */
import {
  normalizarPagos,
  validarPagos,
  pagosParaRpc,
  calcularMontoBoleta,
  desgloseBoleta,
  type PagoInput,
} from "@/lib/ventas/pagos";
import { VentaCreateSchema, CitaAccionSchema } from "@/lib/validation";

const NC_ID = "123e4567-e89b-12d3-a456-426614174000";
const CLIENTE = "223e4567-e89b-12d3-a456-426614174000";
const PROD = "323e4567-e89b-12d3-a456-426614174000";
const ITEMS = [{ producto_id: PROD, cantidad: 1 }];

describe("validarPagos — reglas de dominio", () => {
  it("U-236: acepta 1, 2 y 3 medios cuando la suma es exacta", () => {
    expect(validarPagos([{ metodo: "efectivo", monto: 17000 }], 17000)).toBeNull();
    expect(validarPagos([
      { metodo: "efectivo", monto: 5000 },
      { metodo: "debito", monto: 12000, numeroTransaccion: "TRX1" },
    ], 17000)).toBeNull();
    expect(validarPagos([
      { metodo: "nota_credito", monto: 3000, notaCreditoId: NC_ID },
      { metodo: "efectivo", monto: 2000 },
      { metodo: "credito", monto: 12000, numeroTransaccion: "TRX2" },
    ], 17000, CLIENTE)).toBeNull();
    // La NC solo la usa su dueño: sin cliente en la venta se rechaza.
    expect(validarPagos([
      { metodo: "nota_credito", monto: 3000, notaCreditoId: NC_ID },
      { metodo: "efectivo", monto: 14000 },
    ], 17000)).toMatch(/solo la puede usar su dueño/);
  });

  it("U-237: rechaza suma menor o mayor al total (sin tolerancia ni vuelto)", () => {
    const dos = (a: number, b: number): PagoInput[] => [
      { metodo: "efectivo", monto: a },
      { metodo: "transferencia", monto: b, numeroTransaccion: "T" },
    ];
    expect(validarPagos(dos(5000, 11999), 17000)).toMatch(/no coincide/);
    expect(validarPagos(dos(5000, 12001), 17000)).toMatch(/no coincide/);
  });

  it("U-238: rechaza negativos, decimales y $0 junto a otros pagos; $0 solo como pago único de una venta de $0", () => {
    for (const monto of [-100, 10.5]) {
      expect(validarPagos([{ metodo: "efectivo", monto }], monto)).toMatch(/entero mayor a 0/);
    }
    expect(validarPagos([{ metodo: "efectivo", monto: 0 }, { metodo: "efectivo", monto: 100 }], 100)).toMatch(/entero mayor a 0/);
    // Venta con 100 % de descuento (I-50): un pago de $0.
    expect(validarPagos([{ metodo: "efectivo", monto: 0 }], 0)).toBeNull();
    // $0 contra un total mayor: lo rechaza la suma.
    expect(validarPagos([{ metodo: "efectivo", monto: 0 }], 100)).toMatch(/no coincide/);
  });

  it("U-239: débito, crédito y transferencia exigen número de transacción (por fila)", () => {
    for (const metodo of ["debito", "credito", "transferencia"] as const) {
      expect(validarPagos([
        { metodo: "efectivo", monto: 1000 },
        { metodo, monto: 1000, numeroTransaccion: "  " },
      ], 2000)).toMatch(/número de transacción/);
    }
  });

  it("U-240: NC exige notaCreditoId; notaCreditoId solo en NC; máx. 1 NC y 1 saldo; nunca NC + saldo", () => {
    expect(validarPagos([{ metodo: "nota_credito", monto: 1000 }], 1000)).toMatch(/Falta la nota/);
    expect(validarPagos([{ metodo: "efectivo", monto: 1000, notaCreditoId: NC_ID }], 1000)).toMatch(/Solo un pago con nota/);
    expect(validarPagos([
      { metodo: "nota_credito", monto: 500, notaCreditoId: NC_ID },
      { metodo: "nota_credito", monto: 500, notaCreditoId: NC_ID },
    ], 1000)).toMatch(/una nota de crédito/);
    expect(validarPagos([
      { metodo: "saldo_a_favor", monto: 500 },
      { metodo: "saldo_a_favor", monto: 500 },
    ], 1000, CLIENTE)).toMatch(/saldo a favor una vez/);
    // D8: NC tipo saldo_a_favor y el saldo del cliente son el mismo dinero.
    expect(validarPagos([
      { metodo: "nota_credito", monto: 500, notaCreditoId: NC_ID },
      { metodo: "saldo_a_favor", monto: 500 },
    ], 1000, CLIENTE)).toMatch(/combinar nota de crédito y saldo/);
  });

  it("U-241: saldo a favor exige cliente; más de 5 medios o lista vacía se rechazan", () => {
    expect(validarPagos([{ metodo: "saldo_a_favor", monto: 1000 }], 1000)).toMatch(/requiere un cliente/);
    expect(validarPagos([{ metodo: "saldo_a_favor", monto: 1000 }], 1000, CLIENTE)).toBeNull();
    expect(validarPagos([], 0)).toMatch(/al menos un medio/);
    const seis = Array.from({ length: 6 }, () => ({ metodo: "efectivo" as const, monto: 1 }));
    expect(validarPagos(seis, 6)).toMatch(/Máximo 5/);
  });

  it("U-242: métodos fuera de la lista (plataforma, mixto, saldo_favor) se rechazan", () => {
    for (const metodo of ["plataforma", "mixto", "saldo_favor"]) {
      expect(validarPagos([{ metodo: metodo as never, monto: 1000 }], 1000)).toMatch(/no permitido/);
    }
  });
});

describe("normalizarPagos — formato legado a pagos[]", () => {
  it("U-243: un método → un pago por el total; NC parcial → NC + resto; NC total → solo NC", () => {
    expect(normalizarPagos({ metodoPago: "debito", numeroTransaccion: " T1 " }, 9000))
      .toEqual([{ metodo: "debito", monto: 9000, numeroTransaccion: "T1" }]);
    expect(normalizarPagos({
      metodoPago: "efectivo",
      pagoNc: { nota_credito_id: NC_ID, numero_nc: "NC-1", monto: 4000 },
    }, 9000)).toEqual([
      { metodo: "nota_credito", monto: 4000, notaCreditoId: NC_ID },
      { metodo: "efectivo", monto: 5000, numeroTransaccion: undefined },
    ]);
    expect(normalizarPagos({
      metodoPago: "nota_credito",
      pagoNc: { nota_credito_id: NC_ID, numero_nc: "NC-1", monto: 9000 },
    }, 9000)).toEqual([{ metodo: "nota_credito", monto: 9000, notaCreditoId: NC_ID }]);
  });

  it("U-244: si vienen pagos[] se usan tal cual; pagosParaRpc pasa a snake_case sin TRX vacío", () => {
    const pagos: PagoInput[] = [{ metodo: "efectivo", monto: 100 }];
    expect(normalizarPagos({ pagos }, 100)).toBe(pagos);
    expect(pagosParaRpc([
      { metodo: "debito", monto: 100, numeroTransaccion: "  " },
      { metodo: "nota_credito", monto: 50, notaCreditoId: NC_ID },
    ])).toEqual([
      { metodo: "debito", monto: 100, numero_transaccion: null, nota_credito_id: null },
      { metodo: "nota_credito", monto: 50, numero_transaccion: null, nota_credito_id: NC_ID },
    ]);
  });
});

describe("calcularMontoBoleta — Res. Ex. SII 176/2020", () => {
  it("U-245: 100 % tarjeta → 0; débito + efectivo → solo el efectivo; crédito interno y transferencia se boletean", () => {
    expect(calcularMontoBoleta([{ metodo: "debito", monto: 10000 }, { metodo: "credito", monto: 5000 }])).toBe(0);
    expect(calcularMontoBoleta([{ metodo: "debito", monto: 12000 }, { metodo: "efectivo", monto: 5000 }])).toBe(5000);
    expect(calcularMontoBoleta([
      { metodo: "efectivo", monto: 1000 },
      { metodo: "transferencia", monto: 2000 },
      { metodo: "nota_credito", monto: "3000.00" },
      { metodo: "saldo_a_favor", monto: 4000 },
      { metodo: "credito", monto: 9999 },
    ])).toBe(10000);
  });

  it("U-246: desgloseBoleta agrupa por método y omite tarjetas", () => {
    expect(desgloseBoleta([
      { metodo: "efectivo", monto: 1000 },
      { metodo: "debito", monto: 500 },
      { metodo: "efectivo", monto: 250 },
      { metodo: "nota_credito", monto: 300 },
    ])).toEqual([
      { metodo: "efectivo", monto: 1250 },
      { metodo: "nota_credito", monto: 300 },
    ]);
  });
});

describe("VentaCreateSchema — pagos[] y formato legado", () => {
  it("U-247: acepta pagos[] sin metodoPago, y el formato legado sin pagos[]", () => {
    expect(VentaCreateSchema.safeParse({
      items: ITEMS,
      pagos: [{ metodo: "efectivo", monto: 5000 }, { metodo: "debito", monto: 1000, numeroTransaccion: "T" }],
    }).success).toBe(true);
    expect(VentaCreateSchema.safeParse({ items: ITEMS, metodoPago: "efectivo" }).success).toBe(true);
  });

  it("U-248: rechaza pagos[] junto con metodoPago, pagoNc o numeroTransaccion (dos fuentes de verdad)", () => {
    const pagos = [{ metodo: "efectivo", monto: 5000 }];
    for (const extra of [
      { metodoPago: "efectivo" },
      { numeroTransaccion: "T" },
      { pagoNc: { nota_credito_id: NC_ID, numero_nc: "NC", monto: 1 } },
    ]) {
      expect(VentaCreateSchema.safeParse({ items: ITEMS, pagos, ...extra }).success).toBe(false);
    }
  });

  it("U-249: sin pagos ni metodoPago → 400; legado endurecido (mixto, saldo_favor, plataforma, NC sin pagoNc)", () => {
    expect(VentaCreateSchema.safeParse({ items: ITEMS }).success).toBe(false);
    for (const metodoPago of ["mixto", "saldo_favor", "plataforma"]) {
      expect(VentaCreateSchema.safeParse({ items: ITEMS, metodoPago }).success).toBe(false);
    }
    expect(VentaCreateSchema.safeParse({ items: ITEMS, metodoPago: "nota_credito" }).success).toBe(false);
  });

  it("U-250: el schema aplica las reglas de forma (TRX, NC+saldo, decimales) y rechaza pagos[] en canales externos", () => {
    const parse = (pagos: unknown, extra = {}) => VentaCreateSchema.safeParse({ items: ITEMS, pagos, ...extra }).success;
    expect(parse([{ metodo: "debito", monto: 100 }])).toBe(false);
    expect(parse([{ metodo: "efectivo", monto: 10.5 }])).toBe(false);
    expect(parse([
      { metodo: "nota_credito", monto: 100, notaCreditoId: NC_ID },
      { metodo: "saldo_a_favor", monto: 100 },
    ])).toBe(false);
    expect(parse([{ metodo: "efectivo", monto: 100 }], { canal: "rappi" })).toBe(false);
    expect(parse([{ metodo: "efectivo", monto: 100, notaCreditoId: "no-uuid" }])).toBe(false);
  });
});

describe("CitaAccionSchema — completar con pagos[]", () => {
  it("U-251: completar acepta pagos[], legado o nada (cita sin precio); nunca pagos[] + legado", () => {
    const ok = (body: object) => CitaAccionSchema.safeParse({ accion: "completar", ...body }).success;
    expect(ok({ pagos: [{ metodo: "efectivo", monto: 1000 }, { metodo: "credito", monto: 500, numeroTransaccion: "T" }] })).toBe(true);
    expect(ok({ metodoPago: "efectivo" })).toBe(true);
    expect(ok({})).toBe(true);
    expect(ok({ pagos: [{ metodo: "efectivo", monto: 1000 }], metodoPago: "efectivo" })).toBe(false);
    expect(ok({ pagos: [{ metodo: "transferencia", monto: 1000 }] })).toBe(false);
  });
});

describe("validarPagos — revisión de seguridad (M1)", () => {
  it("U-257: NC o saldo a favor por $0 se rechazan aunque la venta sea de $0 (la NC quedaría 'usada' sin pagar nada)", () => {
    expect(validarPagos([{ metodo: "nota_credito", monto: 0, notaCreditoId: NC_ID }], 0)).toMatch(/entero mayor a 0/);
    expect(validarPagos([{ metodo: "saldo_a_favor", monto: 0 }], 0, CLIENTE)).toMatch(/entero mayor a 0/);
    expect(validarPagos([{ metodo: "efectivo", monto: 0 }], 0)).toBeNull();
  });
});

describe("validarPagos — medios sin repetir", () => {
  it("U-258: un medio de pago no se repite (dos en efectivo o dos con débito se rechazan); medios distintos sí", () => {
    expect(validarPagos([{ metodo: "efectivo", monto: 5000 }, { metodo: "efectivo", monto: 12000 }], 17000))
      .toMatch(/No se puede repetir el medio de pago: efectivo/);
    expect(validarPagos([
      { metodo: "debito", monto: 5000, numeroTransaccion: "T1" },
      { metodo: "efectivo", monto: 2000 },
      { metodo: "debito", monto: 10000, numeroTransaccion: "T2" },
    ], 17000)).toMatch(/No se puede repetir el medio de pago: débito/);
    expect(validarPagos([
      { metodo: "efectivo", monto: 5000 },
      { metodo: "debito", monto: 2000, numeroTransaccion: "T1" },
      { metodo: "credito", monto: 10000, numeroTransaccion: "T2" },
    ], 17000)).toBeNull();
  });
});
