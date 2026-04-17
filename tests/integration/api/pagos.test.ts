import { POST, GET } from "@/app/api/pagos/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

describe("POST /api/pagos", () => {
  const mockStoreId = "store-1";
  const mockVentaId = "venta-1";
  const mockPagoId = "pago-1";

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId });
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
        return Promise.resolve({ data: { id: mockVentaId, total: 10000, store_id: mockStoreId, estado: "pendiente" }, error: null });
      }
      if (callCount === 2) {
        return Promise.resolve({ data: { id: mockPagoId, metodo: "efectivo", monto: 10000 }, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({
        ventaId: mockVentaId,
        metodo: "efectivo",
        monto: 10000,
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.pagoId).toBe(mockPagoId);
  });

  it("rechaza pago con tarjeta sin numero_transaccion", async () => {
    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({
        ventaId: mockVentaId,
        metodo: "credito",
        monto: 10000,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("número de transacción");
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
        return Promise.resolve({ data: { id: mockVentaId, total: 10000, store_id: mockStoreId, estado: "pendiente" }, error: null });
      }
      if (callCount === 2) {
        return Promise.resolve({ data: { id: mockPagoId, metodo: "credito", monto: 10000, numero_transaccion: "TXN123456" }, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({
        ventaId: mockVentaId,
        metodo: "credito",
        monto: 10000,
        numeroTransaccion: "TXN123456",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("rechaza pago con transferencia sin numero_transaccion", async () => {
    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({
        ventaId: mockVentaId,
        metodo: "transferencia",
        monto: 5000,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rechaza metodo_pago inválido", async () => {
    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({
        ventaId: mockVentaId,
        metodo: "bitcoin",
        monto: 10000,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("inválido");
  });

  it("rechaza monto <= 0", async () => {
    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({
        ventaId: mockVentaId,
        metodo: "efectivo",
        monto: 0,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rechaza monto mayor al total de venta", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: mockVentaId, total: 5000, store_id: mockStoreId, estado: "pendiente" },
        error: null,
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({
        ventaId: mockVentaId,
        metodo: "efectivo",
        monto: 10000,
      }),
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
      body: JSON.stringify({
        ventaId: "invalid-venta",
        metodo: "efectivo",
        monto: 10000,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/pagos", {
      method: "POST",
      body: JSON.stringify({
        ventaId: mockVentaId,
        metodo: "efectivo",
        monto: 10000,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/pagos", () => {
  const mockStoreId = "store-1";
  const mockVentaId = "venta-1";

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId });
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
