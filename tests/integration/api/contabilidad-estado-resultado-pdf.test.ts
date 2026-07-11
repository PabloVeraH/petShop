import { NextRequest } from "next/server";
import { GET } from "@/app/api/contabilidad/estado-resultado/pdf/route";

const mockStoreId = "test-store-1";

jest.mock("@/lib/auth", () => ({
  getStoreId: jest.fn(),
}));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(),
}));

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

function setupMocks() {
  (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId });

  const storeChain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: { name: "Test Store", rut: "12.345.678-9" }, error: null }),
  };

  const ventasChain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockResolvedValue({ data: [], error: null }),
  };

  const entriesChain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockResolvedValue({ data: [
      { id: "e1" },
    ], error: null }),
  };

  const detailChain = {
    select: jest.fn().mockReturnThis(),
    in: jest.fn().mockResolvedValue({ data: [
      { cuenta_codigo: "410101", debito: 0, credito: 1000000 },
      { cuenta_codigo: "510101", debito: 600000, credito: 0 },
    ], error: null }),
  };

  let callCount = 0;
  (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
    from: jest.fn((table: string) => {
      callCount++;
      if (table === "stores") return storeChain;
      if (table === "ventas") return ventasChain;
      if (table === "journal_entries") return entriesChain;
      if (table === "journal_detail") return detailChain;
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
        in: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    }),
  });
}

describe("GET /api/contabilidad/estado-resultado/pdf", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("ER-PDF-01: retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/contabilidad/estado-resultado/pdf?mes=04&año=2026");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("ER-PDF-02: retorna HTML con título Estado de Resultado", async () => {
    setupMocks();
    const req = new NextRequest("http://localhost/api/contabilidad/estado-resultado/pdf?mes=04&año=2026");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Estado de Resultado");
    expect(html).toContain("Test Store");
  });

  it("ER-PDF-03: incluye ingresos y gastos en HTML", async () => {
    setupMocks();
    const req = new NextRequest("http://localhost/api/contabilidad/estado-resultado/pdf?mes=04&año=2026");
    const res = await GET(req);
    const html = await res.text();
    expect(html).toContain("Venta de Productos");
    expect(html).toContain("Costo de Bienes Vendidos");
  });

  it("ER-PDF-04: Content-Type es text/html", async () => {
    setupMocks();
    const req = new NextRequest("http://localhost/api/contabilidad/estado-resultado/pdf?mes=04&año=2026");
    const res = await GET(req);
    expect(res.headers.get("Content-Type")).toMatch(/text\/html/);
  });
});
