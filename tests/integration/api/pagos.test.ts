import { POST, GET } from "@/app/api/pagos/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
jest.mock("@/lib/audit", () => ({
  withErrorLogging: (handler) => handler,
  logAudit: jest.fn().mockResolvedValue(undefined),
  getRequestMetadata: jest.fn().mockResolvedValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const VENTA_ID = "123e4567-e89b-12d3-a456-426614174001";
const PAGO_ID  = "123e4567-e89b-12d3-a456-426614174002";

describe("POST /api/pagos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: STORE_ID, userId: "u1" });
  });

  it("registra un pago con efectivo sin numero_transaccion", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };

    let callCount = 0;
    chain.single.mockImplementation(function () {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ data: { id: VENTA_ID, total: 10000, store_id: STORE_ID, estado: "pendiente" }, error: null });
      }
      if (callCount === 2) {
        return Promise.resolve({ data: { id: PAGO_ID, metodo: "efectivo", monto: 10000 }, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({ ventaId: VENTA_ID, metodoPago: "efectivo", monto: 10000 }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.pagoId).toBe(PAGO_ID);
  });

  it("registra pago con tarjeta y numero_transaccion", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };

    let callCount = 0;
    chain.single.mockImplementation(function () {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ data: { id: VENTA_ID, total: 10000, store_id: STORE_ID, estado: "pendiente" }, error: null });
      }
      if (callCount === 2) {
        return Promise.resolve({ data: { id: PAGO_ID, metodo: "credito", monto: 10000, numero_transaccion: "TXN123456" }, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({ ventaId: VENTA_ID, metodoPago: "credito", monto: 10000, numeroTransaccion: "TXN123456" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("rechaza metodo_pago inválido → 400", async () => {
    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({ ventaId: VENTA_ID, metodoPago: "bitcoin", monto: 10000 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rechaza monto <= 0", async () => {
    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({ ventaId: VENTA_ID, metodoPago: "efectivo", monto: 0 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rechaza monto mayor al total de venta", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: VENTA_ID, total: 5000, store_id: STORE_ID, estado: "pendiente" },
        error: null,
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({ ventaId: VENTA_ID, metodoPago: "efectivo", monto: 10000 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("no puede exceder");
  });

  it("retorna 404 si venta no existe", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({ ventaId: VENTA_ID, metodoPago: "efectivo", monto: 10000 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({ ventaId: VENTA_ID, metodoPago: "efectivo", monto: 10000 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("I-317: retorna 500 si falla la consulta de pagos al verificar estado de la venta", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };

    let singleCalls = 0;
    chain.single.mockImplementation(() => {
      singleCalls++;
      if (singleCalls === 1) return Promise.resolve({ data: { id: VENTA_ID, total: 5000, store_id: STORE_ID, estado: "pendiente" }, error: null });
      return Promise.resolve({ data: { id: PAGO_ID, metodo: "efectivo", monto: 5000 }, error: null });
    });

    let eqCallCount = 0;
    chain.eq.mockImplementation(function (...args) {
      eqCallCount++;
      if (eqCallCount === 3) {
        return Promise.resolve({ data: null, error: { message: "DB error consultando pagos" } });
      }
      return this;
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({ ventaId: VENTA_ID, metodoPago: "efectivo", monto: 5000 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Error al verificar pagos");
  });

  it("I-318: retorna 500 si falla el update de estado de venta a pagada", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };

    let singleCalls = 0;
    chain.single.mockImplementation(() => {
      singleCalls++;
      if (singleCalls === 1) return Promise.resolve({ data: { id: VENTA_ID, total: 5000, store_id: STORE_ID, estado: "pendiente" }, error: null });
      return Promise.resolve({ data: { id: PAGO_ID, metodo: "efectivo", monto: 5000 }, error: null });
    });

    let eqCallCount = 0;
    chain.eq.mockImplementation(function (...args) {
      eqCallCount++;
      if (eqCallCount === 3) {
        return Promise.resolve({ data: [{ monto: 5000 }], error: null });
      }
      if (eqCallCount === 4) {
        return Promise.resolve({ data: null, error: { message: "DB error actualizando venta" } });
      }
      return this;
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({ ventaId: VENTA_ID, metodoPago: "efectivo", monto: 5000 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Error al actualizar estado de la venta");
  });
});

describe("GET /api/pagos", () => {
  const mockVentaId = "venta-1";

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: STORE_ID, userId: "u1" });
  });

  it("obtiene pagos de una venta", async () => {
    const mockPagos = [
      { id: "pago-1", metodo: "efectivo", monto: 5000, numero_transaccion: null, created_at: "2026-04-17T10:00:00Z" },
      { id: "pago-2", metodo: "debito", monto: 5000, numero_transaccion: "TXN123", created_at: "2026-04-17T10:05:00Z" },
    ];

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: mockPagos, error: null }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest(`http://localhost/api/pagos?ventaId=${mockVentaId}`);
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data).toHaveLength(2);
    expect(data.data[0].metodo).toBe("efectivo");
    expect(data.data[1].numero_transaccion).toBe("TXN123");
  });

  it("retorna 400 sin ventaId", async () => {
    const req = new NextRequest("http://localhost/api/pagos");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest(`http://localhost/api/pagos?ventaId=${mockVentaId}`);
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
