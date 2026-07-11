import { NextRequest } from "next/server";
import { GET } from "@/app/api/contabilidad/balance-prueba/pdf/route";

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

  const entriesChain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    gte: jest.fn().mockResolvedValue({ data: [
      { id: "e1", fecha: "2026-04-15", total_debito: 11900, total_credito: 11900 },
      { id: "e2", fecha: "2026-04-20", total_debito: 5950, total_credito: 5950 },
    ], error: null }),
  };

  const detailChain = {
    select: jest.fn().mockReturnThis(),
    in: jest.fn().mockResolvedValue({ data: [
      { cuenta_codigo: "110101", cuenta_nombre: "Caja", cuenta_tipo: "Activo", debito: 10000, credito: 0 },
      { cuenta_codigo: "210501", cuenta_nombre: "IVA", cuenta_tipo: "Pasivo", debito: 1900, credito: 0 },
      { cuenta_codigo: "410101", cuenta_nombre: "Ventas", cuenta_tipo: "Ingreso", debito: 0, credito: 11900 },
    ], error: null }),
  };

  let callCount = 0;
  (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
    from: jest.fn((table: string) => {
      callCount++;
      if (table === "stores") return storeChain;
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

describe("GET /api/contabilidad/balance-prueba/pdf", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("BP-PDF-01: retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/contabilidad/balance-prueba/pdf?fecha=2026-04-30");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("BP-PDF-02: retorna HTML con título de Balance de Comprobación", async () => {
    setupMocks();
    const req = new NextRequest("http://localhost/api/contabilidad/balance-prueba/pdf?fecha=2026-04-30");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Balance de Comprobación");
    expect(html).toContain("Test Store");
  });

  it("BP-PDF-03: incluye cuentas contables en HTML", async () => {
    setupMocks();
    const req = new NextRequest("http://localhost/api/contabilidad/balance-prueba/pdf?fecha=2026-04-30");
    const res = await GET(req);
    const html = await res.text();
    expect(html).toContain("110101");
    expect(html).toContain("Caja");
    expect(html).toContain("IVA");
    expect(html).toContain("Ventas");
  });

  it("BP-PDF-04: Content-Type es text/html", async () => {
    setupMocks();
    const req = new NextRequest("http://localhost/api/contabilidad/balance-prueba/pdf?fecha=2026-04-30");
    const res = await GET(req);
    expect(res.headers.get("Content-Type")).toMatch(/text\/html/);
  });
});
