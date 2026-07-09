/**
 * Tests I-306 a I-308: Supplier aggregated stats endpoint
 *
 * Verifies that /api/proveedores/stats returns per-supplier aggregates
 * independent of the currently selected supplier (fix for sidebar bug).
 */
import { GET } from "@/app/api/proveedores/stats/route";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

describe("GET /api/proveedores/stats", () => {
  const mockStoreId = "store-1";
  const PROVIDER_A = "prov-a";
  const PROVIDER_B = "prov-b";
  const PROVIDER_C = "prov-c";

  function makeChain(opts: {
    ordenesData?: Array<{ proveedor_id: string }>;
    cuentasData?: Array<{ proveedor_id: string; monto: number }>;
  }) {
    const ordenesChain: any = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      neq: jest.fn().mockResolvedValue({ data: opts.ordenesData ?? [], error: null }),
    };

    const cuentasChain: any = {
      select: jest.fn().mockReturnThis(),
    };

    let eqCall = 0;
    cuentasChain.eq = jest.fn(function (this: any) {
      eqCall++;
      if (eqCall < 2) return this;
      return Promise.resolve({ data: opts.cuentasData ?? [], error: null });
    });

    return { ordenesChain, cuentasChain };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId, userId: "user-1" });
  });

  // I-306
  it("I-306: retorna stats agregadas por proveedor con ordenes y cuentas", async () => {
    const { ordenesChain, cuentasChain } = makeChain({
      ordenesData: [
        { proveedor_id: PROVIDER_A },
        { proveedor_id: PROVIDER_A },
        { proveedor_id: PROVIDER_B },
      ],
      cuentasData: [
        { proveedor_id: PROVIDER_A, monto: 50000 },
        { proveedor_id: PROVIDER_B, monto: 75000 },
        { proveedor_id: PROVIDER_B, monto: 25000 },
      ],
    });

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "ordenes_compra") return ordenesChain;
        if (table === "cuentas_pagar") return cuentasChain;
      }),
    });

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.orderCounts).toEqual({ [PROVIDER_A]: 2, [PROVIDER_B]: 1 });
    expect(data.payableCounts).toEqual({ [PROVIDER_A]: 1, [PROVIDER_B]: 2 });
    expect(data.payableAmounts).toEqual({ [PROVIDER_A]: 50000, [PROVIDER_B]: 100000 });
    expect(data.payableAmounts[PROVIDER_C]).toBeUndefined();
  });

  // I-307
  it("I-307: retorna 401 si no autenticado", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  // I-308
  it("I-308: retorna objetos vacios cuando no hay ordenes ni cuentas", async () => {
    const { ordenesChain, cuentasChain } = makeChain({});

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === "ordenes_compra") return ordenesChain;
        if (table === "cuentas_pagar") return cuentasChain;
      }),
    });

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.orderCounts).toEqual({});
    expect(data.payableCounts).toEqual({});
    expect(data.payableAmounts).toEqual({});
  });
});
