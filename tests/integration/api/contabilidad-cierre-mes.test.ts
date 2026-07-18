import { NextRequest } from "next/server";

const mockAuth = jest.fn();

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
jest.mock("@/lib/contabilidad/generador-asientos", () => ({
  ...jest.requireActual("@/lib/contabilidad/generador-asientos"),
  crearAsiento: jest.fn().mockResolvedValue("cogs-entry-uuid"),
}));
jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";
import { crearAsiento } from "@/lib/contabilidad/generador-asientos";
import { POST } from "@/app/api/contabilidad/cierre-mes/route";

const STORE_ID = "store-uuid-cierre";

function makeRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/contabilidad/cierre-mes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Creates a Supabase chain mock that supports a variable number of .eq() calls.
 * The terminal call (last method in the chain) returns a promise via .then().
 * Each call to the chain function increments an internal counter so different
 * queries return different results based on call order.
 */
function createChain(resolveValue: object) {
  const chain: Record<string, jest.Mock> & { then?: Function } = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
  };
  // Make the chain thenable (resolves to the provided data)
  chain.then = (resolve: Function) => resolve(resolveValue);
  return chain;
}

describe("POST /api/contabilidad/cierre-mes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({
      storeId: STORE_ID,
      userId: "user-001",
    });
    mockAuth.mockResolvedValue({
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
  });

  describe("autenticación", () => {
    it("retorna 401 cuando no hay sesión", async () => {
      (authModule.getStoreId as jest.Mock).mockResolvedValue(null);
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue(createChain({ data: [], error: null })),
      });

      const res = await POST(makeRequest({ mes: 4, año: 2026 }));

      expect(res.status).toBe(401);
    });

    // I-350: REGRESIÓN — Cierre de Mes es una acción irreversible; sin
    // requireStoreAdmin, cualquier storeWorker autenticado podía ejecutarla.
    it("I-350: REGRESIÓN — retorna 403 cuando el usuario autenticado no es storeAdmin ni systemAdmin", async () => {
      mockAuth.mockResolvedValue({
        sessionClaims: { publicMetadata: { storeWorker: true, storeId: STORE_ID } },
      });
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue(createChain({ data: [], error: null })),
      });

      const res = await POST(makeRequest({ mes: 4, año: 2026 }));

      expect(res.status).toBe(403);
    });
  });

  describe("validación de body", () => {
    function setupValidation() {
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue(createChain({ data: [], error: null })),
      });
    }

    it("retorna 400 cuando falta mes", async () => {
      setupValidation();
      const res = await POST(makeRequest({ año: 2026 }));
      expect(res.status).toBe(400);
    });

    it("retorna 400 cuando falta año", async () => {
      setupValidation();
      const res = await POST(makeRequest({ mes: 4 }));
      expect(res.status).toBe(400);
    });

    it("retorna 400 cuando mes está fuera de rango", async () => {
      setupValidation();
      const res = await POST(makeRequest({ mes: 13, año: 2026 }));
      expect(res.status).toBe(400);
    });

    it("retorna 400 cuando mes es 0", async () => {
      setupValidation();
      const res = await POST(makeRequest({ mes: 0, año: 2026 }));
      expect(res.status).toBe(400);
    });
  });

  describe("conflicto: cierre ya existe", () => {
    function setupExistingCierre() {
      // First query: check cierre existente → encuentra 1
      // Second query: entries del período (no se alcanza porque aborta antes)
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) {
            return createChain({ data: [{ id: "existing-cierre" }], error: null });
          }
          return createChain({ data: [], error: null });
        }),
      });
    }

    it("retorna 409 cuando ya existe un cierre para ese período", async () => {
      setupExistingCierre();
      const res = await POST(makeRequest({ mes: 4, año: 2026 }));

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain("2026-04");
    });
  });

  describe("cierre exitoso sin COGS", () => {
    function setupSuccess(data: Array<{ id: string; total_debito: number; total_credito: number }>) {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) {
            // Check cierre existente → no existe
            return createChain({ data: [], error: null });
          }
          // Entries del período
          return createChain({ data, error: null });
        }),
      });
    }

    it("retorna 201 con resumen del período", async () => {
      setupSuccess([
        { id: "e1", total_debito: 11900, total_credito: 11900 },
        { id: "e2", total_debito: 5950, total_credito: 5950 },
      ]);

      const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: false }));

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.mes_cerrado).toBe("2026-04");
      expect(body.desde).toBe("2026-04-01");
      expect(body.hasta).toBe("2026-04-30");
      expect(body.numero_asientos).toBe(2);
      expect(body.balanceado).toBe(true);
      expect(body.asientos_cierre).toHaveLength(0);
    });

    it("detecta período desbalanceado correctamente", async () => {
      setupSuccess([
        { id: "e1", total_debito: 10000, total_credito: 9000 },
      ]);

      const res = await POST(makeRequest({ mes: 4, año: 2026 }));

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.balanceado).toBe(false);
    });
  });

  describe("cierre con calcular_costo_venta = true", () => {
    it("llama a crearAsiento cuando hay compras con inventario", async () => {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) return createChain({ data: [], error: null }); // check cierre
          if (callCount === 2) return createChain({ data: [{ id: "e1", total_debito: 11900, total_credito: 11900 }], error: null }); // entries
          if (callCount === 3) return createChain({ data: [{ id: "compra-1" }, { id: "compra-2" }], error: null }); // compras
          return createChain({ data: [{ debito: 5000 }, { debito: 3000 }], error: null }); // inventario lines
        }),
      });

      const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: true }));

      expect(res.status).toBe(201);
      expect(crearAsiento).toHaveBeenCalledWith(
        expect.objectContaining({
          tipoMovimiento: "CIERRE_MES",
          referenciaNomero: "2026-04",
        })
      );
      const body = await res.json();
      expect(body.asientos_cierre).toHaveLength(1);
      expect(body.asientos_cierre[0].tipo).toBe("COSTO_VENTA");
    });

    it("no crea asiento COGS cuando no hay compras en el período", async () => {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) return createChain({ data: [], error: null }); // check cierre
          if (callCount === 2) return createChain({ data: [], error: null }); // entries
          return createChain({ data: [], error: null }); // compras (vacío)
        }),
      });

      const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: true }));

      expect(res.status).toBe(201);
      expect(crearAsiento).not.toHaveBeenCalled();
      const body = await res.json();
      expect(body.asientos_cierre).toHaveLength(0);
    });
  });

  describe("respuesta 201 incluye todos los campos de feedback", () => {
    it("REGRESIÓN: retorna mes_cerrado, numero_asientos, balanceado y asientos_cierre", async () => {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) return createChain({ data: [], error: null }); // check cierre
          return createChain({
            data: [
              { id: "e1", total_debito: 11900, total_credito: 11900 },
              { id: "e2", total_debito: 5950, total_credito: 5950 },
              { id: "e3", total_debito: 2380, total_credito: 2380 },
            ],
            error: null,
          }); // entries
        }),
      });

      const res = await POST(makeRequest({ mes: 6, año: 2026, calcular_costo_venta: false }));
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body).toHaveProperty("mes_cerrado", "2026-06");
      expect(body).toHaveProperty("desde", "2026-06-01");
      expect(body).toHaveProperty("hasta", "2026-06-30");
      expect(body).toHaveProperty("numero_asientos", 3);
      expect(body).toHaveProperty("balanceado", true);
      expect(body).toHaveProperty("asientos_cierre");
      expect(Array.isArray(body.asientos_cierre)).toBe(true);
    });

    it("retorna error con status 409 cuando ya existe cierre (feedback de error para la UI)", async () => {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) return createChain({ data: [{ id: "existing" }], error: null });
          return createChain({ data: [], error: null });
        }),
      });

      const res = await POST(makeRequest({ mes: 6, año: 2026 }));
      expect(res.status).toBe(409);

      const body = await res.json();
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);
    });
  });

  describe("fechas correctas por mes", () => {
    function setupFecha(mes: number, año: number, esperado: string) {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) return createChain({ data: [], error: null }); // check cierre
          return createChain({ data: [], error: null }); // entries
        }),
      });
    }

    it("calcula correctamente el último día de febrero (año bisiesto)", async () => {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) return createChain({ data: [], error: null });
          return createChain({ data: [], error: null });
        }),
      });

      const res = await POST(makeRequest({ mes: 2, año: 2024 }));
      const body = await res.json();
      expect(body.hasta).toBe("2024-02-29");
    });

    it("calcula correctamente el último día de febrero (año no bisiesto)", async () => {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) return createChain({ data: [], error: null });
          return createChain({ data: [], error: null });
        }),
      });

      const res = await POST(makeRequest({ mes: 2, año: 2026 }));
      const body = await res.json();
      expect(body.hasta).toBe("2026-02-28");
    });
  });

  // I-315: REGRESIÓN — la verificación de duplicados usa select+array en vez de .single()
  // para evitar que múltiples filas (o error PGRST116) permitan un segundo cierre.
  describe("I-315: seguridad anti-duplicados", () => {
    it("I-315: retorna 409 aunque existan múltiples asientos de cierre para el mismo período", async () => {
      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1) {
            // Múltiples cierres existentes (escenario de carrera/fallo parcial)
            return createChain({
              data: [
                { id: "cierre-1" },
                { id: "cierre-2" },
              ],
              error: null,
            });
          }
          return createChain({ data: [], error: null });
        }),
      });

      const res = await POST(makeRequest({ mes: 4, año: 2026 }));

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain("2026-04");
    });
  });

  // I-323 / I-324: manejo de carrera en crearAsiento — si retorna null porque
  // otro request concurrente creó el cierre antes, devuelve 409 (no 201).
  // Si retorna null sin concurrencia, devuelve 500.
  describe("I-323/324: crearAsiento retorna null (race condition o fallo)", () => {
    it("I-323: crearAsiento retorna null y existe cierre concurrente → 409", async () => {
      (crearAsiento as jest.Mock).mockImplementationOnce(() => Promise.resolve(null));

      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1 || callCount === 2) return createChain({ data: [], error: null });
          if (callCount === 3) return createChain({ data: [{ id: "compra-1" }], error: null });
          if (callCount === 4) return createChain({ data: [{ debito: 5000 }], error: null });
          return createChain({ data: [{ id: "cierre-concurrente" }], error: null });
        }),
      });

      const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: true }));

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain("concurrente");
      expect(body.error).toContain("2026-04");
    });

    it("I-324: crearAsiento retorna null sin cierre concurrente → 500", async () => {
      (crearAsiento as jest.Mock).mockImplementationOnce(() => Promise.resolve(null));

      let callCount = 0;
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => {
          callCount++;
          if (callCount === 1 || callCount === 2) return createChain({ data: [], error: null });
          if (callCount === 3) return createChain({ data: [{ id: "compra-1" }], error: null });
          if (callCount === 4) return createChain({ data: [{ debito: 5000 }], error: null });
          return createChain({ data: [], error: null });
        }),
      });

      const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: true }));

      expect(res.status).toBe(500);
      expect((await res.json()).error).toContain("costo de ventas");
    });
  });
});
