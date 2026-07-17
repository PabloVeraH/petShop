import { GET } from "@/app/api/contabilidad/cierre-mes/preview/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

const STORE_ID = "store-uuid-preview";

/**
 * Creates a Supabase chain mock supporting .select(), .eq(), .gte(), .lte(), .in()
 */
function createChain(resolveValue: object) {
  const chain: Record<string, jest.Mock> & { then?: Function } = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
  };
  chain.then = (resolve: Function) => resolve(resolveValue);
  return chain;
}

function makeRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

describe("GET /api/contabilidad/cierre-mes/preview", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({
      storeId: STORE_ID,
      userId: "user-preview-001",
    });
  });

  describe("autenticación", () => {
    it("retorna 401 cuando no hay sesión", async () => {
      (authModule.getStoreId as jest.Mock).mockResolvedValue(null);
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue(createChain({ data: [], error: null })),
      });

      const res = await GET(makeRequest("http://localhost/api/contabilidad/cierre-mes/preview?mes=4&año=2026"));

      expect(res.status).toBe(401);
    });
  });

  describe("validación de parámetros", () => {
    it("retorna 400 cuando falta mes", async () => {
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue(createChain({ data: [], error: null })),
      });

      const res = await GET(makeRequest("http://localhost/api/contabilidad/cierre-mes/preview?año=2026"));

      expect(res.status).toBe(400);
    });

    it("retorna 400 cuando falta año", async () => {
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue(createChain({ data: [], error: null })),
      });

      const res = await GET(makeRequest("http://localhost/api/contabilidad/cierre-mes/preview?mes=4"));

      expect(res.status).toBe(400);
    });

    it("retorna 400 cuando mes está fuera de rango", async () => {
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue(createChain({ data: [], error: null })),
      });

      const res = await GET(makeRequest("http://localhost/api/contabilidad/cierre-mes/preview?mes=13&año=2026"));

      expect(res.status).toBe(400);
    });
  });

  describe("preview sin COGS", () => {
    it("retorna preview con datos del período sin crear asientos", async () => {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) return createChain({ data: [], error: null }); // check cierre
          return createChain({
            data: [
              { id: "e1", total_debito: 11900, total_credito: 11900 },
              { id: "e2", total_debito: 5950, total_credito: 5950 },
            ],
            error: null,
          }); // entries
        }),
      });

      const res = await GET(makeRequest(
        "http://localhost/api/contabilidad/cierre-mes/preview?mes=4&año=2026&calcular_costo_venta=false"
      ));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.periodo).toBe("2026-04");
      expect(body.numero_asientos).toBe(2);
      expect(body.cogs_estimado).toBe(0);
      expect(body.ya_tiene_cierre).toBe(false);
      expect(body.asientos_cierre_count).toBe(0);
      expect(body.balanceado).toBe(true);
    });

    it("reporta ya_tiene_cierre=true cuando el período ya está cerrado", async () => {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) return createChain({ data: [{ id: "existing-cierre" }], error: null });
          return createChain({ data: [], error: null });
        }),
      });

      const res = await GET(makeRequest(
        "http://localhost/api/contabilidad/cierre-mes/preview?mes=4&año=2026"
      ));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ya_tiene_cierre).toBe(true);
    });

    it("detecta período desbalanceado", async () => {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) return createChain({ data: [], error: null });
          return createChain({
            data: [{ id: "e1", total_debito: 10000, total_credito: 9000 }],
            error: null,
          });
        }),
      });

      const res = await GET(makeRequest(
        "http://localhost/api/contabilidad/cierre-mes/preview?mes=4&año=2026"
      ));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.balanceado).toBe(false);
    });
  });

  describe("preview con COGS", () => {
    it("calcula cogs_estimado desde compras del período", async () => {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) return createChain({ data: [], error: null }); // check cierre
          if (callCount === 2) return createChain({
            data: [{ id: "e1", total_debito: 11900, total_credito: 11900 }],
            error: null,
          }); // entries
          if (callCount === 3) return createChain({
            data: [{ id: "compra-1" }, { id: "compra-2" }],
            error: null,
          }); // compras
          return createChain({
            data: [{ debito: 5000 }, { debito: 3000 }],
            error: null,
          }); // inventory lines
        }),
      });

      const res = await GET(makeRequest(
        "http://localhost/api/contabilidad/cierre-mes/preview?mes=4&año=2026&calcular_costo_venta=true"
      ));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.cogs_estimado).toBe(8000);
      expect(body.asientos_cierre_count).toBe(1);
    });

    it("reporta cogs_estimado=0 cuando no hay compras en el período", async () => {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) return createChain({ data: [], error: null }); // check cierre
          if (callCount === 2) return createChain({ data: [], error: null }); // entries
          return createChain({ data: [], error: null }); // compras (vacío)
        }),
      });

      const res = await GET(makeRequest(
        "http://localhost/api/contabilidad/cierre-mes/preview?mes=4&año=2026&calcular_costo_venta=true"
      ));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.cogs_estimado).toBe(0);
      expect(body.asientos_cierre_count).toBe(0);
    });
  });

  describe("preview no produce efectos secundarios", () => {
    it("NO llama a crearAsiento ni inserta en cierre_mes_backups", async () => {
      let callCount = 0;
      const fromMock = jest.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: [], error: null });
        if (callCount === 2) return createChain({
          data: [{ id: "e1", total_debito: 100, total_credito: 100 }],
          error: null,
        });
        if (callCount === 3) return createChain({ data: [], error: null });
        return createChain({ data: [], error: null });
      });

      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: fromMock,
      });

      const res = await GET(makeRequest(
        "http://localhost/api/contabilidad/cierre-mes/preview?mes=4&año=2026&calcular_costo_venta=true"
      ));

      expect(res.status).toBe(200);

      // Verify only SELECT queries were called (no INSERT/UPDATE/DELETE)
      const insertCalls = fromMock.mock.calls.filter((c: string[]) => c[0] === "cierre_mes_backups");
      expect(insertCalls).toHaveLength(0);
    });
  });

  describe("fechas correctas por mes", () => {
    it("calcula febrero bisiesto (2024)", async () => {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) return createChain({ data: [], error: null });
          return createChain({ data: [], error: null });
        }),
      });

      const res = await GET(makeRequest(
        "http://localhost/api/contabilidad/cierre-mes/preview?mes=2&año=2024"
      ));

      const body = await res.json();
      expect(body.desde).toBe("2024-02-01");
      expect(body.hasta).toBe("2024-02-29");
    });

    it("calcula febrero no bisiesto (2026)", async () => {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) return createChain({ data: [], error: null });
          return createChain({ data: [], error: null });
        }),
      });

      const res = await GET(makeRequest(
        "http://localhost/api/contabilidad/cierre-mes/preview?mes=2&año=2026"
      ));

      const body = await res.json();
      expect(body.desde).toBe("2026-02-01");
      expect(body.hasta).toBe("2026-02-28");
    });
  });
});
