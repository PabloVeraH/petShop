import { GET, POST } from "@/app/api/saldos-a-favor/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

const STORE_ID   = "123e4567-e89b-12d3-a456-426614174000";
const CLIENTE_ID = "123e4567-e89b-12d3-a456-426614174010";
const VENTA_ID   = "123e4567-e89b-12d3-a456-426614174011";

describe("GET /api/saldos-a-favor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: STORE_ID });
  });

  it("obtiene saldo disponible del cliente", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { saldo_disponible: 5000 },
        error: null,
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest(`http://localhost/api/saldos-a-favor?clienteId=${CLIENTE_ID}`);
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.saldo_disponible).toBe(5000);
  });

  it("retorna 0 si cliente no tiene saldo registrado", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "not found" },
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest(`http://localhost/api/saldos-a-favor?clienteId=${CLIENTE_ID}`);
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.saldo_disponible).toBe(0);
  });

  it("retorna 400 sin clienteId", async () => {
    const req = new NextRequest("http://localhost/api/saldos-a-favor");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest(`http://localhost/api/saldos-a-favor?clienteId=${CLIENTE_ID}`);
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/saldos-a-favor (usar saldo en compra)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: STORE_ID });
  });

  it("usa saldo a favor en compra exitosamente", async () => {
    const saldoChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { saldo_disponible: 5000 },
        error: null,
      }),
    };

    const pagoChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: "pago-1" },
        error: null,
      }),
    };

    const updateChain = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    };

    let tableCall = 0;
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "saldos_a_favor") {
          tableCall++;
          if (tableCall === 1) return saldoChain;
          return updateChain;
        }
        return pagoChain;
      }),
    });

    const req = new NextRequest("http://localhost/api/saldos-a-favor", {
      method: "POST",
      body: JSON.stringify({ clienteId: CLIENTE_ID, ventaId: VENTA_ID, monto: 3000 }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.pagoId).toBe("pago-1");
    expect(data.montoUsado).toBe(3000);
    expect(data.saldoDisponibleAnterior).toBe(5000);
    expect(data.saldoDisponibleNuevo).toBe(2000);
  });

  it("rechaza uso de saldo si monto > saldo disponible", async () => {
    const saldoChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { saldo_disponible: 2000 },
        error: null,
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(saldoChain),
    });

    const req = new NextRequest("http://localhost/api/saldos-a-favor", {
      method: "POST",
      body: JSON.stringify({ clienteId: CLIENTE_ID, ventaId: VENTA_ID, monto: 5000 }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("Saldo insuficiente");
  });

  it("usa saldo total disponible (monto = saldo)", async () => {
    const saldoChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { saldo_disponible: 5000 },
        error: null,
      }),
    };

    const pagoChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: "pago-2" },
        error: null,
      }),
    };

    const updateChain = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    };

    let tableCall = 0;
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "saldos_a_favor") {
          tableCall++;
          if (tableCall === 1) return saldoChain;
          return updateChain;
        }
        return pagoChain;
      }),
    });

    const req = new NextRequest("http://localhost/api/saldos-a-favor", {
      method: "POST",
      body: JSON.stringify({ clienteId: CLIENTE_ID, ventaId: VENTA_ID, monto: 5000 }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.saldoDisponibleNuevo).toBe(0);
  });

  it("retorna 400 sin clienteId", async () => {
    const req = new NextRequest("http://localhost/api/saldos-a-favor", {
      method: "POST",
      body: JSON.stringify({ ventaId: VENTA_ID, monto: 1000 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("retorna 400 sin ventaId", async () => {
    const req = new NextRequest("http://localhost/api/saldos-a-favor", {
      method: "POST",
      body: JSON.stringify({ clienteId: CLIENTE_ID, monto: 1000 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("retorna 400 si monto <= 0", async () => {
    const req = new NextRequest("http://localhost/api/saldos-a-favor", {
      method: "POST",
      body: JSON.stringify({ clienteId: CLIENTE_ID, ventaId: VENTA_ID, monto: 0 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/saldos-a-favor", {
      method: "POST",
      body: JSON.stringify({ clienteId: CLIENTE_ID, ventaId: VENTA_ID, monto: 1000 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("registra pago en tabla pagos con metodo saldo_a_favor", async () => {
    const saldoChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { saldo_disponible: 5000 },
        error: null,
      }),
    };

    const pagoChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: "pago-3" },
        error: null,
      }),
    };

    const updateChain = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    };

    let tableCall = 0;
    const mockFrom = jest.fn((table: string) => {
      if (table === "saldos_a_favor") {
        tableCall++;
        if (tableCall === 1) return saldoChain;
        return updateChain;
      }
      return pagoChain;
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: mockFrom,
    });

    const req = new NextRequest("http://localhost/api/saldos-a-favor", {
      method: "POST",
      body: JSON.stringify({ clienteId: CLIENTE_ID, ventaId: VENTA_ID, monto: 2000 }),
    });

    await POST(req);

    expect(mockFrom).toHaveBeenCalledWith("pagos");
    expect(pagoChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        store_id: STORE_ID,
        venta_id: VENTA_ID,
        metodo: "saldo_a_favor",
        monto: 2000,
        numero_transaccion: null,
      })
    );
  });
});
