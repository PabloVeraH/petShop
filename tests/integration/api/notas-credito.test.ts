/**
 * Tests: POST/GET /api/notas-credito y devoluciones
 * Cobertura: creación de notas, restitución stock, rollback fidelización, saldo_a_favor
 */
import { NextRequest, after } from "next/server";
import { crearAsiento } from "@/lib/contabilidad/generador-asientos";
import { CUENTAS } from "@/lib/contabilidad/types";

jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return {
    ...actual,
    // after() requiere request scope (lanza fuera de él). En tests llamamos a
    // POST() directamente sin request scope: ejecutamos el callback en el
    // momento, replicando el timing del código anterior.
    after: jest.fn((cb: () => void) => cb()),
  };
});

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const CLIENTE_ID = "223e4567-e89b-12d3-a456-426614174001";
const VENTA_ID = "323e4567-e89b-12d3-a456-426614174002";

// Drena la cola de microtareas para dejar que el bloque fire-and-forget
// (asiento contable) avance más allá de POST()'s propio return — POST no
// espera ese bloque, así que inspeccionar crearAsiento inmediatamente
// después de `await POST(...)` es una condición de carrera con sus propios
// awaits internos (fetch de nombre de cliente, luego crearAsiento x2).
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn().mockResolvedValue({ data: null, error: null });

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));
jest.mock("@/lib/contabilidad/generador-asientos", () => {
  const actual = jest.requireActual("@/lib/contabilidad/generador-asientos");
  return {
    ...actual,
    crearAsiento: jest.fn().mockResolvedValue("asiento-uuid"),
  };
});

function makeEmptyFrom() {
  const chain: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    order: jest.fn().mockResolvedValue({ data: [], error: null }),
    upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
    limit: jest.fn().mockResolvedValue({ data: null, error: null }),
    gt: jest.fn().mockReturnThis(),
  };
  return jest.fn(() => chain);
}

function rpcSuccess(overrides?: Record<string, unknown>) {
  mockRpc.mockResolvedValue({
    data: {
      id: "nc1",
      numero_nc: "NC-20260416-ABC123D1",
      monto_total: 2000,
      costo_total: 0,
      venta_cliente_id: CLIENTE_ID,
      ...overrides,
    },
    error: null,
  });
}

function makeFromDevolucion(
  venta: any = null,
  ventaItems: any[] = [],
  saldo: any = null,
  fidel: any = null
) {
  const queries = { ventas: 0, venta_items: 0, notas_credito: 0, nc_items: 0, productos: 0, saldos: 0, fidel: 0, stock_movements: 0, updates: 0 };

  return jest.fn((table: string) => {
    const chain: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
      upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
      limit: jest.fn().mockResolvedValue({ data: null, error: null }),
      gt: jest.fn().mockReturnThis(),
    };

    if (table === "ventas") {
      queries.ventas++;
      chain.single.mockResolvedValue({ data: venta, error: venta ? null : new Error("Not found") });
      return chain;
    }
    if (table === "venta_items") {
      queries.venta_items++;
      chain.single.mockResolvedValue({ data: ventaItems[queries.venta_items - 1] ?? null, error: null });
      return chain;
    }
    if (table === "notas_credito") {
      queries.notas_credito++;
      if (queries.notas_credito === 1) {
        // POST insert
        chain.insert.mockReturnThis();
        chain.single.mockResolvedValue({
          data: { id: "nc1", numero_nc: "NC-20260416-ABC123D1" },
          error: null,
        });
      } else {
        // GET query
        chain.order.mockResolvedValue({ data: [], error: null });
      }
      return chain;
    }
    if (table === "nota_credito_items") {
      queries.nc_items++;
      chain.insert.mockResolvedValue({ error: null });
      return chain;
    }
    // Nota: ya no hay caso "productos" — la restitución de stock sin lotes
    // usa el RPC increment_stock (mockRpc, resuelve {data:null,error:null}
    // por defecto), no consulta la tabla productos directamente. Ver I-456.
    if (table === "stock_movements") {
      queries.stock_movements++;
      chain.insert.mockResolvedValue({ error: null });
      return chain;
    }
    if (table === "saldos_a_favor") {
      queries.saldos++;
      chain.single.mockResolvedValue({ data: saldo, error: saldo ? null : { message: "Not found", code: "PGRST116" } });
      chain.upsert.mockResolvedValue({ data: null, error: null });
      return chain;
    }
    if (table === "fidelizacion") {
      queries.fidel++;
      if (queries.fidel % 2 === 1) {
        // SELECT fidelización
        chain.single.mockResolvedValue({ data: fidel, error: fidel ? null : { message: "Not found", code: "PGRST116" } });
      } else {
        // UPDATE fidelización
        chain.eq.mockResolvedValue({ data: null, error: null });
      }
      return chain;
    }
    return chain;
  });
}

describe("POST /api/notas-credito", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID, systemAdmin: false });
    rpcSuccess();
    mockFrom.mockImplementation(makeEmptyFrom());
  });

  const NC_ID = "423e4567-e89b-12d3-a456-426614174003";
  const ITEM_ID2 = "623e4567-e89b-12d3-a456-426614174005";

  it("devolución parcial exitosa → crea NC y retorna numeroNc", async () => {
    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 2, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.notaCreditoId).toBe("nc1");
    expect(body.numeroNc).toMatch(/^NC-\d{8}-[A-Z0-9]{8}$/);
    expect(mockRpc).toHaveBeenCalledWith("crear_nota_credito_tx", expect.objectContaining({
      p_venta_id: VENTA_ID,
      p_tipo_reembolso: "reembolso_directo",
    }));
  });

  it("sin ventaId → 400", async () => {
    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({ items: [], tipoReembolso: "reembolso_directo" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("items vacío → 400", async () => {
    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({ ventaId: VENTA_ID, items: [], tipoReembolso: "reembolso_directo" }),
      })
    );
    expect(res.status).toBe(400);
  });

  // I-464 — MEJORA (ticket Trello 6a62eb3057bc5972b4ca8dcc): motivo sigue
  // opcional, pero si se ingresa algo debe alcanzar un mínimo de trazabilidad
  // real para auditoría/Libro Diario — un solo carácter no sirve.
  it("I-464: motivo con menos de 5 caracteres → 400", async () => {
    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 1 }],
          tipoReembolso: "reembolso_directo",
          motivo: "abc",
        }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/al menos 5 caracteres/i);
  });

  // I-465
  it("I-465: motivo con exactamente 5 caracteres → aceptado", async () => {
    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 1 }],
          tipoReembolso: "reembolso_directo",
          motivo: "abcde",
        }),
      })
    );
    expect(res.status).toBe(200);
  });

  it("tipoReembolso inválido → 400", async () => {
    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 1 }],
          tipoReembolso: "invalido",
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("venta no encontrada → 500", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Venta no encontrada en esta tienda" } });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 1 }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/no encontrada/i);
  });

  it("venta anulada → 500", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "No se puede devolver una venta anulada" } });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 1 }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/anulada/i);
  });

  it("cantidad devuelta > cantidad original → 500", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "excede el disponible" } });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 5 }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );
    expect(res.status).toBe(500);
  });

  it("devolución con restituirStock=true → pasa restituir_stock al RPC", async () => {
    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 3, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("crear_nota_credito_tx", expect.objectContaining({
      p_items: expect.arrayContaining([
        expect.objectContaining({ venta_item_id: NC_ID, cantidad_devuelta: 3, restituir_stock: true }),
      ]),
    }));
  });

  it("I-456 (actualizado): la atómica ahora es crear_nota_credito_tx, no llamadas separadas", async () => {
    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 4, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("crear_nota_credito_tx", expect.any(Object));
  });

  it("devolución sin restituirStock → envía restituir_stock: false al RPC", async () => {
    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 2, restituirStock: false }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("crear_nota_credito_tx", expect.objectContaining({
      p_items: expect.arrayContaining([
        expect.objectContaining({ restituir_stock: false }),
      ]),
    }));
  });

  it("devolución saldo_a_favor → llama al RPC con tipo correcto", async () => {
    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 2, restituirStock: false }],
          tipoReembolso: "saldo_a_favor",
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("crear_nota_credito_tx", expect.objectContaining({
      p_tipo_reembolso: "saldo_a_favor",
    }));
  });

  it("devolución saldo_a_favor → 500 si el RPC falla", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "db error" } });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 1, restituirStock: false }],
          tipoReembolso: "saldo_a_favor",
        }),
      })
    );

    expect(res.status).toBe(500);
  });

  it("devolución parcial → pasa monto_total del RPC a la respuesta", async () => {
    rpcSuccess({ monto_total: 2000 });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 2, restituirStock: false }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.montoNc).toBe(2000);
  });

  it("I-109: descuento 10% → monto NC del RPC se refleja en respuesta", async () => {
    rpcSuccess({ monto_total: 1800 });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 2, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.montoNc).toBe(1800);
  });

  it("I-110: descuento 0% → monto NC del RPC se refleja en respuesta", async () => {
    rpcSuccess({ monto_total: 3000 });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 3, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.montoNc).toBe(3000);
  });

  it("múltiples items → llama RPC con array de items", async () => {
    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [
            { ventaItemId: NC_ID, cantidadDevuelta: 2 },
            { ventaItemId: ITEM_ID2, cantidadDevuelta: 1 },
          ],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("crear_nota_credito_tx", expect.objectContaining({
      p_items: expect.arrayContaining([
        expect.objectContaining({ venta_item_id: NC_ID, cantidad_devuelta: 2 }),
        expect.objectContaining({ venta_item_id: ITEM_ID2, cantidad_devuelta: 1 }),
      ]),
    }));
  });

  // I-NCC-INT-01 a I-NCC-INT-03: REGRESIÓN — la devolución con NC debía
  // revertir solo el ingreso (lineasNotaCredito) y nunca el COGS, a
  // diferencia de la anulación de venta que sí revierte ambos. Ver AGENTS.md
  // (ticket Trello 6a5c650d...) y crearAsiento mockeado arriba para poder
  // inspeccionar los asientos disparados por el bloque fire-and-forget.
  it("I-NCC-INT-01: costo_total > 0 del RPC → crea reverso de COGS", async () => {
    rpcSuccess({ costo_total: 1500, venta_cliente_id: CLIENTE_ID });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 3, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );
    expect(res.status).toBe(200);
    await flushPromises();

    expect(crearAsiento).toHaveBeenCalledTimes(2);

    const cogsCall = (crearAsiento as jest.Mock).mock.calls[1][0];
    const lineaCogs = cogsCall.lineas.find(
      (l: { cuentaCodigo: string }) => l.cuentaCodigo === CUENTAS.COGS.codigo
    );
    const lineaInv = cogsCall.lineas.find(
      (l: { cuentaCodigo: string }) => l.cuentaCodigo === CUENTAS.INVENTARIO.codigo
    );
    expect(lineaCogs).toBeDefined();
    expect(lineaCogs.debito).toBe(0);
    expect(lineaCogs.credito).toBe(1500);
    expect(lineaInv.debito).toBe(1500);
    expect(lineaInv.credito).toBe(0);
  });

  // I-492: REGRESIÓN — mismo patrón que I-491 (ticket Trello
  // 6a77e779358cdccca29dc3e3): el asiento NC y su reverso de COGS son dos
  // crearAsiento() secuenciales dentro del mismo callback. Antes de este fix
  // vivían en un IIFE fire-and-forget sin after()/waitUntil, que en
  // serverless podía quedar congelado a mitad de ejecución y dejar la NC con
  // el asiento de devolución pero sin el reverso de COGS. Ahora el bloque se
  // agenda con after(), que garantiza que la plataforma espere a que ambos
  // asientos se creen tras responder.
  it("I-492: REGRESIÓN — NC con costo agenda el asiento contable vía after() y crea ambos asientos", async () => {
    rpcSuccess({ costo_total: 1500, venta_cliente_id: CLIENTE_ID });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 3, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );
    expect(res.status).toBe(200);
    await flushPromises();

    expect(after).toHaveBeenCalledTimes(1);
    expect(crearAsiento).toHaveBeenCalledTimes(2);
  });

  it("I-NCC-INT-02: costo_total = 0 del RPC (restituirStock=false) → NO crea reverso de COGS", async () => {
    rpcSuccess({ costo_total: 0, venta_cliente_id: CLIENTE_ID });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 3, restituirStock: false }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );
    expect(res.status).toBe(200);
    await flushPromises();

    expect(crearAsiento).toHaveBeenCalledTimes(1);
  });

  it("I-NCC-INT-03: costo_total = 0 del RPC (sin costo) → NO crea reverso de COGS", async () => {
    rpcSuccess({ costo_total: 0, venta_cliente_id: CLIENTE_ID });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 3, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );
    expect(res.status).toBe(200);
    await flushPromises();
    expect(crearAsiento).toHaveBeenCalledTimes(1);
  });

  it("sin auth → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 1 }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("overreturn bloqueado por devoluciones previas → 500 del RPC", async () => {
    const ITEM_ID = "a23e4567-e89b-12d3-a456-426614174aaa";
    mockRpc.mockResolvedValue({ data: null, error: { message: "excede el disponible" } });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: ITEM_ID, cantidadDevuelta: 2 }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/excede|disponible/i);
  });

  it("devolución dentro del disponible considerando previas → 200", async () => {
    const ITEM_ID = "a23e4567-e89b-12d3-a456-426614174aaa";

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: ITEM_ID, cantidadDevuelta: 1, restituirStock: false }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  // SEC-01/02: IDOR — ahora validado dentro de crear_nota_credito_tx
  // (la función recibe store_id y venta_id, y la BD verifica ownership
  // mediante WHERE store_id = p_store_id en ventas y venta_items.venta_id).
  // La ruta NO hace consultas directas a venta_items desde JS.
  it("SEC-01: ventaItemId que no pertenece al ventaId → 500 del RPC", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "no pertenece a la venta" } });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "f00e4567-e89b-12d3-a456-426614174f00", cantidadDevuelta: 1 }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/pertenece/i);
  });

  it("SEC-02: ventaItemId de otra venta → 500 del RPC", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "no pertenece a la venta" } });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "888e4567-e89b-12d3-a456-426614174888", cantidadDevuelta: 1 }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/pertenece/i);
  });

  // SEC-03 actualizado: la validación de ownership se delega a la función
  // crear_nota_credito_tx (p_store_id + venta_id filtran en la BD).
  it("SEC-03: el RPC crear_nota_credito_tx recibe store_id para filtrar ownership", async () => {
    const { POST } = await import("@/app/api/notas-credito/route");
    await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 1, restituirStock: false }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(mockRpc).toHaveBeenCalledWith("crear_nota_credito_tx", expect.objectContaining({
      p_store_id: STORE_ID,
      p_venta_id: VENTA_ID,
    }));
  });

  // I-485: REGRESIÓN (ticket Trello 6a76cc3f6fc812dda0a2ce43) — el error del
  // RPC por fallo de restitución de stock (SQLSTATE 42703 "record "v_item" has
  // no field "item"") debe llegar al cliente con el mensaje del RPC, no
  // perderse. El fix de la causa raíz es la migración 070 (jsonb_to_recordset
  // en el loop de restitución); este test protege el contrato de propagación
  // del error 500 + mensaje al frontend para que el modal lo muestre.
  it("I-485: fallo del RPC por restitución de stock → 500 con el mensaje del RPC", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'record "v_item" has no field "item"' },
    });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: NC_ID, cantidadDevuelta: 1, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('record "v_item" has no field "item"');
  });
});

describe("GET /api/notas-credito", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID, systemAdmin: false });
    mockFrom.mockImplementation(makeFromDevolucion());
  });

  it("sin ventaId → 400", async () => {
    const { GET } = await import("@/app/api/notas-credito/route");
    const res = await GET(new NextRequest("http://localhost/api/notas-credito"));
    expect(res.status).toBe(400);
  });

  it("ventaId válido → retorna notas ordenadas", async () => {
    const { GET } = await import("@/app/api/notas-credito/route");
    const res = await GET(new NextRequest(`http://localhost/api/notas-credito?ventaId=${VENTA_ID}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("sin auth → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);

    const { GET } = await import("@/app/api/notas-credito/route");
    const res = await GET(new NextRequest(`http://localhost/api/notas-credito?ventaId=${VENTA_ID}`));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/saldos-a-favor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID, systemAdmin: false });
  });

  it("sin clienteId → 400", async () => {
    const { GET } = await import("@/app/api/saldos-a-favor/route");
    const res = await GET(new NextRequest("http://localhost/api/saldos-a-favor"));
    expect(res.status).toBe(400);
  });

  it("cliente sin saldo → retorna 0", async () => {
    mockFrom.mockImplementation(makeFromDevolucion(null, [], null));

    const { GET } = await import("@/app/api/saldos-a-favor/route");
    const res = await GET(new NextRequest(`http://localhost/api/saldos-a-favor?clienteId=${CLIENTE_ID}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saldo_disponible).toBe(0);
  });

  it("cliente con saldo → retorna saldo_disponible", async () => {
    mockFrom.mockImplementation(makeFromDevolucion(null, [], { saldo_disponible: 5000 }));

    const { GET } = await import("@/app/api/saldos-a-favor/route");
    const res = await GET(new NextRequest(`http://localhost/api/saldos-a-favor?clienteId=${CLIENTE_ID}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saldo_disponible).toBe(5000);
  });

  it("sin auth → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);

    const { GET } = await import("@/app/api/saldos-a-favor/route");
    const res = await GET(new NextRequest(`http://localhost/api/saldos-a-favor?clienteId=${CLIENTE_ID}`));
    expect(res.status).toBe(401);
  });
});
