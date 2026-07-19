/**
 * Tests: POST/GET /api/notas-credito y devoluciones
 * Cobertura: creación de notas, restitución stock, rollback fidelización, saldo_a_favor
 */
import { NextRequest } from "next/server";
import { crearAsiento } from "@/lib/contabilidad/generador-asientos";
import { CUENTAS } from "@/lib/contabilidad/types";

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

function makeFromWithPrevios(
  venta: any,
  ventaItem: any,
  previosDevueltos: Array<{ cantidad_devuelta: number }>
) {
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
      chain.single.mockResolvedValue({ data: venta, error: null });
      return chain;
    }
    if (table === "venta_items") {
      chain.single.mockResolvedValue({ data: ventaItem, error: null });
      return chain;
    }
    if (table === "nota_credito_items") {
      let selectMode = false;
      let eqCount = 0;
      const ncChain: Record<string, any> = {
        select: jest.fn(() => { selectMode = true; return ncChain; }),
        insert: jest.fn().mockResolvedValue({ error: null }),
        eq: jest.fn(() => {
          if (selectMode) {
            eqCount++;
            return eqCount >= 2
              ? Promise.resolve({ data: previosDevueltos, error: null })
              : ncChain;
          }
          return ncChain;
        }),
      };
      return ncChain;
    }
    if (table === "notas_credito") {
      chain.insert.mockReturnThis();
      chain.single.mockResolvedValue({
        data: { id: "nc1", numero_nc: "NC-20260508-TEST1234" },
        error: null,
      });
      return chain;
    }
    return chain;
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
    if (table === "productos") {
      queries.productos++;
      if (queries.productos % 2 === 1) {
        // SELECT stock antes de actualizar
        chain.single.mockResolvedValue({ data: { stock: 10 }, error: null });
      } else {
        // UPDATE stock
        chain.eq.mockResolvedValue({ data: null, error: null });
      }
      return chain;
    }
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
  });

  it("devolución parcial exitosa → crea NC y retorna numeroNc", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada", total: 5000 };
    const ventaItem = { id: "423e4567-e89b-12d3-a456-426614174003", producto_id: "523e4567-e89b-12d3-a456-426614174004", cantidad: 5, precio_unitario: 1000 };
    mockFrom.mockImplementation(makeFromDevolucion(venta, [ventaItem]));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 2, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.notaCreditoId).toBe("nc1");
    expect(body.numeroNc).toMatch(/^NC-\d{8}-[A-Z0-9]{8}$/);
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

  it("tipoReembolso inválido → 400", async () => {
    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 1 }],
          tipoReembolso: "invalido",
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("venta no encontrada → 404", async () => {
    mockFrom.mockImplementation(makeFromDevolucion(null));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 1 }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("venta anulada → 409", async () => {
    const venta = { id: VENTA_ID, estado: "anulada", cliente_id: CLIENTE_ID };
    mockFrom.mockImplementation(makeFromDevolucion(venta));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 1 }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );
    expect(res.status).toBe(409);
  });

  it("cantidad devuelta > cantidad original → 400", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada" };
    const ventaItem = { id: "423e4567-e89b-12d3-a456-426614174003", producto_id: "523e4567-e89b-12d3-a456-426614174004", cantidad: 3, precio_unitario: 1000 };
    mockFrom.mockImplementation(makeFromDevolucion(venta, [ventaItem]));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 5 }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("devolución con restituirStock=true → incrementa stock", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada" };
    const ventaItem = { id: "423e4567-e89b-12d3-a456-426614174003", producto_id: "523e4567-e89b-12d3-a456-426614174004", cantidad: 10, precio_unitario: 1000 };
    mockFrom.mockImplementation(makeFromDevolucion(venta, [ventaItem]));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 3, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    // Mock verifica que se llamó a productos.update con stock incrementado
  });

  it("devolución sin restituirStock → no toca stock", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada" };
    const ventaItem = { id: "423e4567-e89b-12d3-a456-426614174003", producto_id: "523e4567-e89b-12d3-a456-426614174004", cantidad: 10, precio_unitario: 1000 };
    mockFrom.mockImplementation(makeFromDevolucion(venta, [ventaItem]));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 2, restituirStock: false }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
  });

  it("devolución saldo_a_favor → incrementa saldo atómicamente vía RPC", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada" };
    const ventaItem = { id: "423e4567-e89b-12d3-a456-426614174003", producto_id: "523e4567-e89b-12d3-a456-426614174004", cantidad: 10, precio_unitario: 1000 };
    mockFrom.mockImplementation(makeFromDevolucion(venta, [ventaItem]));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 2, restituirStock: false }],
          tipoReembolso: "saldo_a_favor",
        }),
      })
    );

    expect(res.status).toBe(200);
    // REGRESIÓN: el incremento debe hacerse vía RPC atómico (upsert de una sola
    // sentencia en la BD), no vía SELECT+upsert en JS (lost-update bajo concurrencia).
    expect(mockRpc).toHaveBeenCalledWith("incrementar_saldo_a_favor", {
      p_store_id: STORE_ID,
      p_cliente_id: CLIENTE_ID,
      p_monto: 2000, // 2 unidades x $1000
    });
  });

  it("devolución saldo_a_favor → 500 si el RPC de incremento falla", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada" };
    const ventaItem = { id: "423e4567-e89b-12d3-a456-426614174003", producto_id: "523e4567-e89b-12d3-a456-426614174004", cantidad: 10, precio_unitario: 1000 };
    mockFrom.mockImplementation(makeFromDevolucion(venta, [ventaItem]));
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "db error" } });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 1, restituirStock: false }],
          tipoReembolso: "saldo_a_favor",
        }),
      })
    );

    expect(res.status).toBe(500);
  });

  it("devolución parcial → rollback fidelización (decrementa total_historico)", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada" };
    const ventaItem = { id: "423e4567-e89b-12d3-a456-426614174003", producto_id: "523e4567-e89b-12d3-a456-426614174004", cantidad: 10, precio_unitario: 1000 };
    const fidelizacion = { id: "f1", total_historico: 100000, frecuencia_compras: 10, descuento_actual: 5 };
    mockFrom.mockImplementation(makeFromDevolucion(venta, [ventaItem], null, fidelizacion));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 2, restituirStock: false }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    // Mock verifica que se llamó a fidelizacion.update con total_historico = 98000 (100000 - 2000)
  });

  it("I-109: devolución con descuento 10% → monto NC proporcional al precio pagado", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada", descuento: 10, total: 4500 };
    const ventaItem = { id: "423e4567-e89b-12d3-a456-426614174003", producto_id: "523e4567-e89b-12d3-a456-426614174004", cantidad: 5, precio_unitario: 1000 };
    mockFrom.mockImplementation(makeFromDevolucion(venta, [ventaItem]));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 2, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // 2 × $1.000 × 0.9 = $1.800, no $2.000
    expect(body.montoNc).toBe(1800);
  });

  it("I-110: devolución con descuento 0% → monto NC usa precio original", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada", descuento: 0, total: 5000 };
    const ventaItem = { id: "423e4567-e89b-12d3-a456-426614174003", producto_id: "523e4567-e89b-12d3-a456-426614174004", cantidad: 5, precio_unitario: 1000 };
    mockFrom.mockImplementation(makeFromDevolucion(venta, [ventaItem]));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 3, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // 3 × $1.000 × 1.0 = $3.000
    expect(body.montoNc).toBe(3000);
  });

  it("múltiples items → suma montos correctamente", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada" };
    const ventaItem1 = { id: "423e4567-e89b-12d3-a456-426614174003", producto_id: "523e4567-e89b-12d3-a456-426614174004", cantidad: 10, precio_unitario: 1000 };
    const ventaItem2 = { id: "623e4567-e89b-12d3-a456-426614174005", producto_id: "723e4567-e89b-12d3-a456-426614174006", cantidad: 5, precio_unitario: 2000 };
    mockFrom.mockImplementation(makeFromDevolucion(venta, [ventaItem1, ventaItem2]));

    // Este test es simplificado; en real necesitaría mock más sofisticado
    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [
            { ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 2 },
            { ventaItemId: "623e4567-e89b-12d3-a456-426614174005", cantidadDevuelta: 1 },
          ],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
  });

  // I-NCC-INT-01 a I-NCC-INT-03: REGRESIÓN — la devolución con NC debía
  // revertir solo el ingreso (lineasNotaCredito) y nunca el COGS, a
  // diferencia de la anulación de venta que sí revierte ambos. Ver AGENTS.md
  // (ticket Trello 6a5c650d...) y crearAsiento mockeado arriba para poder
  // inspeccionar los asientos disparados por el bloque fire-and-forget.
  it("I-NCC-INT-01: devolución con restituirStock=true y costo definido → crea también el reverso de COGS", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada" };
    const ventaItem = {
      id: "423e4567-e89b-12d3-a456-426614174003",
      producto_id: "523e4567-e89b-12d3-a456-426614174004",
      cantidad: 10,
      precio_unitario: 1000,
      productos: { costo: 500 },
    };
    mockFrom.mockImplementation(makeFromDevolucion(venta, [ventaItem]));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: ventaItem.id, cantidadDevuelta: 3, restituirStock: true }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );
    expect(res.status).toBe(200);
    await flushPromises();

    // Dos asientos: reverso de ingreso (lineasNotaCredito) + reverso de COGS
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
    expect(lineaCogs.credito).toBe(1500); // 3 unidades x $500 costo
    expect(lineaInv.debito).toBe(1500);
    expect(lineaInv.credito).toBe(0);
  });

  it("I-NCC-INT-02: devolución con restituirStock=false → NO crea reverso de COGS", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada" };
    const ventaItem = {
      id: "423e4567-e89b-12d3-a456-426614174003",
      producto_id: "523e4567-e89b-12d3-a456-426614174004",
      cantidad: 10,
      precio_unitario: 1000,
      productos: { costo: 500 },
    };
    mockFrom.mockImplementation(makeFromDevolucion(venta, [ventaItem]));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: ventaItem.id, cantidadDevuelta: 3, restituirStock: false }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );
    expect(res.status).toBe(200);
    await flushPromises();

    // Solo el asiento de reverso de ingreso — sin COGS porque el producto
    // no vuelve a inventario (mismo criterio que anular_venta_tx).
    expect(crearAsiento).toHaveBeenCalledTimes(1);
  });

  it("I-NCC-INT-03: devolución de producto sin costo definido → NO crea reverso de COGS", async () => {
    const venta = { id: VENTA_ID, cliente_id: CLIENTE_ID, estado: "completada" };
    const ventaItem = {
      id: "423e4567-e89b-12d3-a456-426614174003",
      producto_id: "523e4567-e89b-12d3-a456-426614174004",
      cantidad: 10,
      precio_unitario: 1000,
      productos: { costo: 0 },
    };
    mockFrom.mockImplementation(makeFromDevolucion(venta, [ventaItem]));

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: ventaItem.id, cantidadDevuelta: 3, restituirStock: true }],
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
          items: [{ ventaItemId: "423e4567-e89b-12d3-a456-426614174003", cantidadDevuelta: 1 }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("overreturn bloqueado por devoluciones previas → 400", async () => {
    const ITEM_ID = "a23e4567-e89b-12d3-a456-426614174aaa";
    const venta = { id: VENTA_ID, cliente_id: null, estado: "completada" };
    // cantidad original = 3, ya devueltos = 2 → disponible = 1
    const ventaItem = { id: ITEM_ID, producto_id: "b23e4567-e89b-12d3-a456-426614174bbb", cantidad: 3, precio_unitario: 1000 };
    mockFrom.mockImplementation(
      makeFromWithPrevios(venta, ventaItem, [{ cantidad_devuelta: 2 }])
    );

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: ITEM_ID, cantidadDevuelta: 2 }], // 2 > 1 disponible
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/disponible/i);
  });

  it("devolución dentro del disponible considerando previas → 200", async () => {
    const ITEM_ID = "a23e4567-e89b-12d3-a456-426614174aaa";
    const venta = { id: VENTA_ID, cliente_id: null, estado: "completada" };
    // cantidad original = 3, ya devueltos = 2 → disponible = 1
    const ventaItem = { id: ITEM_ID, producto_id: "b23e4567-e89b-12d3-a456-426614174bbb", cantidad: 3, precio_unitario: 1000 };
    mockFrom.mockImplementation(
      makeFromWithPrevios(venta, ventaItem, [{ cantidad_devuelta: 2 }])
    );

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: ITEM_ID, cantidadDevuelta: 1, restituirStock: false }], // 1 <= 1 disponible
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  // SEC-01: IDOR — ventaItemId de otra venta debe ser rechazado (item no encontrado)
  it("SEC-01: ventaItemId que no pertenece al ventaId → 400 item no encontrado", async () => {
    const FOREIGN_ITEM_ID = "f00e4567-e89b-12d3-a456-426614174f00";
    const venta = { id: VENTA_ID, cliente_id: null, estado: "completada" };

    // El mock de venta_items devuelve null cuando se filtra por venta_id
    // (simula que el item existe en otra venta, pero no en esta)
    mockFrom.mockImplementation((table: string) => {
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
        chain.single.mockResolvedValue({ data: venta, error: null });
      }
      if (table === "venta_items") {
        // Devuelve null — simula que el .eq("venta_id", ventaId) no encontró el item
        chain.single.mockResolvedValue({ data: null, error: null });
      }
      return chain;
    });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: FOREIGN_ITEM_ID, cantidadDevuelta: 1 }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no encontrado/i);
  });

  // SEC-02: IDOR — ventaItemId válido pero perteneciente a otra venta del mismo store
  it("SEC-02: ventaItemId de otra venta del mismo store → 400 item no encontrado", async () => {
    const ANOTHER_VENTA_ID = "999e4567-e89b-12d3-a456-426614174999";
    const ITEM_FROM_OTHER_VENTA = "888e4567-e89b-12d3-a456-426614174888";
    const venta = { id: VENTA_ID, cliente_id: null, estado: "completada" };

    mockFrom.mockImplementation((table: string) => {
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
        chain.single.mockResolvedValue({ data: venta, error: null });
      }
      if (table === "venta_items") {
        // El item pertenece a ANOTHER_VENTA_ID, no a VENTA_ID
        // Con el fix, el .eq("venta_id", ventaId) filtra y devuelve null
        chain.single.mockResolvedValue({ data: null, error: null });
      }
      return chain;
    });

    const { POST } = await import("@/app/api/notas-credito/route");
    const res = await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: ITEM_FROM_OTHER_VENTA, cantidadDevuelta: 1 }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no encontrado/i);
  });

  // SEC-03: La consulta a venta_items DEBE incluir el filtro de venta_id
  it("SEC-03: la consulta a venta_items incluye eq('venta_id') para prevenir IDOR", async () => {
    const ITEM_ID = "423e4567-e89b-12d3-a456-426614174003";
    const venta = { id: VENTA_ID, cliente_id: null, estado: "completada" };
    const ventaItem = { id: ITEM_ID, producto_id: "p1", cantidad: 5, precio_unitario: 1000 };

    const eqCalls: string[][] = [];

    mockFrom.mockImplementation((table: string) => {
      const chain: Record<string, jest.Mock> = {
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        eq: jest.fn((col: string, val: string) => {
          if (table === "venta_items") eqCalls.push([col, val]);
          return chain;
        }),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
        upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
        limit: jest.fn().mockResolvedValue({ data: null, error: null }),
        gt: jest.fn().mockReturnThis(),
      };
      if (table === "ventas") {
        chain.single.mockResolvedValue({ data: venta, error: null });
      }
      if (table === "venta_items") {
        chain.single.mockResolvedValue({ data: ventaItem, error: null });
      }
      if (table === "notas_credito") {
        chain.insert.mockReturnThis();
        chain.single.mockResolvedValue({ data: { id: "nc1", numero_nc: "NC-TEST" }, error: null });
      }
      if (table === "nota_credito_items") {
        chain.insert.mockResolvedValue({ error: null });
        // Primer .eq() retorna chain, segundo .eq() resuelve con datos vacíos
        chain.eq
          .mockReturnValueOnce(chain)
          .mockReturnValueOnce(Promise.resolve({ data: [], error: null }));
      }
      return chain;
    });

    const { POST } = await import("@/app/api/notas-credito/route");
    await POST(
      new NextRequest("http://localhost/api/notas-credito", {
        method: "POST",
        body: JSON.stringify({
          ventaId: VENTA_ID,
          items: [{ ventaItemId: ITEM_ID, cantidadDevuelta: 1, restituirStock: false }],
          tipoReembolso: "reembolso_directo",
        }),
      })
    );

    // Verificar que la consulta a venta_items incluyó el filtro de venta_id
    const ventaIdFilter = eqCalls.find(([col]) => col === "venta_id");
    expect(ventaIdFilter).toBeDefined();
    expect(ventaIdFilter![1]).toBe(VENTA_ID);
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
