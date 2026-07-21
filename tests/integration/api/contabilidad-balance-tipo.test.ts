import { NextRequest } from "next/server";
import { GET } from "@/app/api/contabilidad/balance-prueba/route";

const mockStoreId = "test-store-1";

jest.mock("@/lib/auth", () => ({
  getStoreId: jest.fn(),
}));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(),
}));

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";
import { CUENTAS } from "@/lib/contabilidad/types";

function setupMocks(detalleOverrides: Array<{
  cuenta_codigo: string;
  cuenta_nombre: string;
  cuenta_tipo: string;
  debito: number;
  credito: number;
}>) {
  (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId });

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
    in: jest.fn().mockResolvedValue({ data: detalleOverrides, error: null }),
  };

  (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
    from: jest.fn((table: string) => {
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

describe("GET /api/contabilidad/balance-prueba — tipo resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // I-429: REGRESIÓN — el balance resuelve el tipo desde CUENTAS en vez de
  // usar el valor almacenado en journal_detail. Esto asegura que cuentas
  // reclasificadas (ej. 110502: ACTIVO → PASIVO) se muestren correctamente
  // incluso para asientos creados antes del cambio.
  // Ticket Trello: 6a5e9486a242880262f9556f
  it("I-429: SALDOS_FAVOR se muestra como PASIVO aunque journal_detail tenga ACTIVO", async () => {
    setupMocks([
      // Simula un journal_detail con tipo desactualizado (ACTIVO)
      { cuenta_codigo: CUENTAS.SALDOS_FAVOR.codigo, cuenta_nombre: CUENTAS.SALDOS_FAVOR.nombre, cuenta_tipo: "ACTIVO", debito: 0, credito: 50000 },
    ]);

    const req = new NextRequest("http://localhost/api/contabilidad/balance-prueba?fecha=2026-04-30");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.cuentas).toHaveLength(1);
    expect(body.cuentas[0].codigo).toBe(CUENTAS.SALDOS_FAVOR.codigo);
    // Debe resolver como PASIVO (desde CUENTAS), no ACTIVO (desde journal_detail)
    expect(body.cuentas[0].tipo).toBe("PASIVO");
    expect(body.cuentas[0].tipo).not.toBe("ACTIVO");
  });

  it("tipo de cuenta Caja se resuelve como ACTIVO", async () => {
    setupMocks([
      { cuenta_codigo: CUENTAS.CAJA.codigo, cuenta_nombre: CUENTAS.CAJA.nombre, cuenta_tipo: "", debito: 10000, credito: 0 },
    ]);

    const req = new NextRequest("http://localhost/api/contabilidad/balance-prueba?fecha=2026-04-30");
    const res = await GET(req);
    const body = await res.json();

    expect(body.cuentas[0].tipo).toBe("ACTIVO");
  });

  it("tipo de cuenta Proveedores se resuelve como PASIVO", async () => {
    setupMocks([
      { cuenta_codigo: CUENTAS.PROVEEDORES.codigo, cuenta_nombre: CUENTAS.PROVEEDORES.nombre, cuenta_tipo: "", debito: 0, credito: 5000 },
    ]);

    const req = new NextRequest("http://localhost/api/contabilidad/balance-prueba?fecha=2026-04-30");
    const res = await GET(req);
    const body = await res.json();

    expect(body.cuentas[0].tipo).toBe("PASIVO");
  });

  it("tipo de cuenta Ventas se resuelve como INGRESO", async () => {
    setupMocks([
      { cuenta_codigo: CUENTAS.VENTAS.codigo, cuenta_nombre: CUENTAS.VENTAS.nombre, cuenta_tipo: "", debito: 0, credito: 10000 },
    ]);

    const req = new NextRequest("http://localhost/api/contabilidad/balance-prueba?fecha=2026-04-30");
    const res = await GET(req);
    const body = await res.json();

    expect(body.cuentas[0].tipo).toBe("INGRESO");
  });

  it("usuario no autenticado retorna 401", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/contabilidad/balance-prueba?fecha=2026-04-30");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("fallback a journal_detail.cuenta_tipo para códigos no en CUENTAS", async () => {
    setupMocks([
      { cuenta_codigo: "999999", cuenta_nombre: "Cuenta Desconocida", cuenta_tipo: "OTRO", debito: 1000, credito: 0 },
    ]);

    const req = new NextRequest("http://localhost/api/contabilidad/balance-prueba?fecha=2026-04-30");
    const res = await GET(req);
    const body = await res.json();

    expect(body.cuentas[0].tipo).toBe("OTRO");
  });
});
