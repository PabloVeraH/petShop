/**
 * POST /api/ventas — pago mixto (docs/plan_pago_mixto.md, F4).
 * I-787…I-799. La RPC real (validar_pagos / aplicar_pagos) se prueba en
 * tests/sql/093_pago_mixto.test.sql; aquí, el contrato de la ruta: validación
 * en el límite, pre-validación de la NC, parámetros a la RPC, mapeo de
 * errores y asiento contable.
 */
import { NextRequest } from "next/server";

jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return { ...actual, after: jest.fn((cb: () => void) => cb()) };
});

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const OTRA_TIENDA = "999e4567-e89b-12d3-a456-426614174000";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174010";
const CLIENTE_ID = "123e4567-e89b-12d3-a456-426614174020";
const NC_ID = "123e4567-e89b-12d3-a456-426614174040";

const mockRpc = jest.fn();
const mockGetStoreId = jest.fn();
let ncRow: Record<string, unknown> | null = null;
const ncEqs: unknown[][] = [];

jest.mock("@/lib/auth", () => ({ getStoreId: () => mockGetStoreId() }));
jest.mock("@/lib/whatsapp", () => ({ sendWhatsAppText: jest.fn(), buildReceiptMessage: jest.fn() }));
jest.mock("@/lib/hub-sync", () => ({ syncPurchaseToHub: jest.fn(), syncProductsToHub: jest.fn() }));
jest.mock("@/lib/email", () => ({ sendBoletaEmail: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  getRequestMetadata: jest.fn().mockReturnValue({ ipAddress: "1.1.1.1", userAgent: "jest" }),
  withErrorLogging: (h: unknown) => h,
}));
jest.mock("@/lib/contabilidad/generador-asientos", () => {
  const actual = jest.requireActual("@/lib/contabilidad/generador-asientos");
  return { ...actual, crearAsiento: jest.fn().mockResolvedValue("asiento") };
});

// Cadena de Supabase genérica: cada método devuelve la cadena; las lecturas
// terminales resuelven según la tabla.
function chain(table: string) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  for (const m of ["select", "insert", "update", "upsert", "in", "gt", "order", "limit"]) c[m] = jest.fn(self);
  c.eq = jest.fn((...args: unknown[]) => {
    if (table === "notas_credito") ncEqs.push(args);
    return c;
  });
  c.single = jest.fn(async () => {
    if (table === "notas_credito") return { data: ncRow, error: null };
    if (table === "stores") return { data: { name: "PetShop", whatsapp_enabled: false, email_reminder_dias_aviso: 5, fidelizacion_niveles: null }, error: null };
    if (table === "clientes") return { data: { nombre: "Ana", rut: "1-9", email: "ana@example.com" }, error: null };
    return { data: null, error: null };
  });
  // Lecturas sin .single(): productos (precio) y venta_items.
  c.then = (resolve: (v: unknown) => void) => {
    if (table === "productos") {
      return resolve({ data: [{ id: PRODUCTO_ID, nombre: "Saco", precio: 8500, precio_oferta: null, en_oferta: false, stock: 10, costo: 4000 }], error: null });
    }
    return resolve({ data: [], error: null });
  };
  return c;
}

jest.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({ from: (t: string) => chain(t), rpc: (...a: unknown[]) => mockRpc(...a) }),
}));

import { POST } from "@/app/api/ventas/route";
import { crearAsiento } from "@/lib/contabilidad/generador-asientos";
import { sendBoletaEmail } from "@/lib/email";
import { CUENTAS } from "@/lib/contabilidad/types";

// 2 sacos × $8.500 = $17.000 (total calculado por el servidor).
const ITEMS = [{ producto_id: PRODUCTO_ID, cantidad: 2 }];
const VENTA = { id: "venta-1", total: 17000, metodo_pago: "mixto", numero_comprobante: "20261112-ABCD1234", created_at: "2026-11-12T15:00:00" };

function post(body: object) {
  return POST(new NextRequest("http://localhost/api/ventas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

const NC_OK = { id: NC_ID, numero_nc: "NC-77", monto_total: 3000, fecha_vencimiento: null, estado: "activa", tipo_reembolso: "saldo_a_favor" };

beforeEach(() => {
  jest.clearAllMocks();
  ncEqs.length = 0;
  ncRow = NC_OK;
  mockGetStoreId.mockResolvedValue({ userId: "user-1", storeId: STORE_ID });
  mockRpc.mockResolvedValue({ data: { venta: VENTA, created: true }, error: null });
});

describe("POST /api/ventas — pago mixto", () => {
  it("I-787: efectivo + débito → 200; la RPC recibe p_pagos exactos y el asiento tiene Caja y Banco por su monto", async () => {
    const res = await post({
      items: ITEMS,
      pagos: [{ metodo: "efectivo", monto: 5000 }, { metodo: "debito", monto: 12000, numeroTransaccion: " TRX9 " }],
    });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_store_id: STORE_ID,
      p_total: 17000,
      p_metodo_pago: null,
      p_pago_nc: null,
      p_numero_transaccion: null,
      p_pagos: [
        { metodo: "efectivo", monto: 5000, numero_transaccion: null, nota_credito_id: null },
        { metodo: "debito", monto: 12000, numero_transaccion: "TRX9", nota_credito_id: null },
      ],
    }));
    const asiento = (crearAsiento as jest.Mock).mock.calls[0][0];
    // La etiqueta viene de la venta que devuelve la RPC (validar_pagos).
    expect(asiento.descripcion).toBe("Venta mixto");
    const caja = asiento.lineas.find((l: { cuentaCodigo: string }) => l.cuentaCodigo === CUENTAS.CAJA.codigo);
    const banco = asiento.lineas.find((l: { cuentaCodigo: string }) => l.cuentaCodigo === CUENTAS.BANCO.codigo);
    expect(caja.debito).toBe(5000);
    expect(banco.debito).toBe(12000);
    const debe = asiento.lineas.reduce((s: number, l: { debito: number }) => s + l.debito, 0);
    const haber = asiento.lineas.reduce((s: number, l: { credito: number }) => s + l.credito, 0);
    expect([debe, haber]).toEqual([17000, 17000]);
  });

  it("I-788: sin sesión → 401 y no se llama a la RPC", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const res = await post({ items: ITEMS, pagos: [{ metodo: "efectivo", monto: 17000 }] });
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-789: la suma se valida contra el total del SERVIDOR (no del cliente): suma distinta → 400 sin RPC", async () => {
    for (const pagos of [
      [{ metodo: "efectivo", monto: 5000 }, { metodo: "debito", monto: 11999, numeroTransaccion: "T" }],
      [{ metodo: "efectivo", monto: 17001 }],
    ]) {
      const res = await post({ items: ITEMS, pagos, total: 17000 });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/no coincide con el total/);
    }
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-790: store_id / storeId malicioso en el body se ignora: la RPC usa la tienda de la sesión", async () => {
    await post({ items: ITEMS, store_id: OTRA_TIENDA, storeId: OTRA_TIENDA, pagos: [{ metodo: "efectivo", monto: 17000 }] });
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({ p_store_id: STORE_ID }));
  });

  it("I-791: NC de otra tienda (IDOR) → la búsqueda filtra por la tienda de la sesión, 404 y sin RPC", async () => {
    ncRow = null; // con el filtro por store_id, la NC ajena no aparece
    const res = await post({
      items: ITEMS,
      pagos: [{ metodo: "nota_credito", monto: 3000, notaCreditoId: NC_ID }, { metodo: "efectivo", monto: 14000 }],
    });
    expect(res.status).toBe(404);
    expect(ncEqs).toContainEqual(["store_id", STORE_ID]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-792: NC con reembolso directo (D7) → 409 sin RPC", async () => {
    ncRow = { ...NC_OK, tipo_reembolso: "reembolso_directo" };
    const res = await post({
      items: ITEMS,
      pagos: [{ metodo: "nota_credito", monto: 3000, notaCreditoId: NC_ID }, { metodo: "efectivo", monto: 14000 }],
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/reembolsó directamente/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-793: saldo a favor sin cliente → 400; con cliente → 200 y viaja en p_pagos", async () => {
    const pagos = [{ metodo: "saldo_a_favor", monto: 4000 }, { metodo: "efectivo", monto: 13000 }];
    let res = await post({ items: ITEMS, pagos });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();

    res = await post({ items: ITEMS, clienteId: CLIENTE_ID, pagos });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_cliente_id: CLIENTE_ID,
      p_pagos: expect.arrayContaining([{ metodo: "saldo_a_favor", monto: 4000, numero_transaccion: null, nota_credito_id: null }]),
    }));
  });

  it("I-794: errores del cobro de la RPC se mapean por ERRCODE (saldo insuficiente NO se confunde con stock)", async () => {
    const casos: [string, number][] = [
      ["PV001", 400], ["PV002", 404], ["PV003", 409], ["PV004", 410], ["PV005", 409], ["PV006", 409], ["PV007", 400],
    ];
    for (const [code, status] of casos) {
      mockRpc.mockResolvedValueOnce({ data: null, error: { code, message: `Saldo a favor insuficiente (${code})` } });
      const res = await post({ items: ITEMS, pagos: [{ metodo: "efectivo", monto: 17000 }] });
      expect([code, res.status]).toEqual([code, status]);
      expect((await res.json()).error).toBe(`Saldo a favor insuficiente (${code})`);
    }
  });

  it("I-795: pagos[] junto con metodoPago, más de 5 medios, o NC + saldo → 400 sin RPC", async () => {
    const bodies = [
      { pagos: [{ metodo: "efectivo", monto: 17000 }], metodoPago: "efectivo" },
      { pagos: Array.from({ length: 6 }, (_, i) => ({ metodo: "efectivo", monto: i === 0 ? 12000 : 1000 })) },
      { clienteId: CLIENTE_ID, pagos: [
        { metodo: "nota_credito", monto: 3000, notaCreditoId: NC_ID },
        { metodo: "saldo_a_favor", monto: 1000 },
        { metodo: "efectivo", monto: 13000 },
      ] },
    ];
    for (const b of bodies) {
      const res = await post({ items: ITEMS, ...b });
      expect(res.status).toBe(400);
    }
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-796: pagos[] en una venta de canal externo → 400 (los cobra la plataforma)", async () => {
    const res = await post({ items: ITEMS, canal: "rappi", pagos: [{ metodo: "efectivo", monto: 17000 }] });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-797: formato legado endurecido — 'mixto', 'saldo_favor', 'plataforma' o NC sin pagoNc → 400", async () => {
    for (const metodoPago of ["mixto", "saldo_favor", "plataforma", "nota_credito"]) {
      const res = await post({ items: ITEMS, metodoPago });
      expect([metodoPago, res.status]).toEqual([metodoPago, 400]);
    }
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-798: el correo al cliente lleva el desglose real de pagos (NC con su número)", async () => {
    await post({
      items: ITEMS,
      clienteId: CLIENTE_ID,
      enviarEmail: true,
      pagos: [{ metodo: "nota_credito", monto: 3000, notaCreditoId: NC_ID }, { metodo: "credito", monto: 14000, numeroTransaccion: "T1" }],
    });
    const { boleta } = (sendBoletaEmail as jest.Mock).mock.calls[0][0];
    expect(boleta.pagos).toEqual([
      { metodo: "nota_credito", monto: 3000, numero_transaccion: "NC-77" },
      { metodo: "credito", monto: 14000, numero_transaccion: "T1" },
    ]);
  });

  it("I-799: reintento idempotente (created=false) → devuelve la venta sin repetir asiento ni correo", async () => {
    mockRpc.mockResolvedValue({ data: { venta: VENTA, created: false }, error: null });
    const res = await post({
      items: ITEMS, clienteId: CLIENTE_ID, enviarEmail: true,
      idempotencyKey: "123e4567-e89b-12d3-a456-426614174099",
      pagos: [{ metodo: "efectivo", monto: 5000 }, { metodo: "debito", monto: 12000, numeroTransaccion: "T" }],
    });
    expect(res.status).toBe(200);
    expect(crearAsiento).not.toHaveBeenCalled();
    expect(sendBoletaEmail).not.toHaveBeenCalled();
  });
});
