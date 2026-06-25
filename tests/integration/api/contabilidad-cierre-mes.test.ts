import { POST } from "@/app/api/contabilidad/cierre-mes/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
jest.mock("@/lib/contabilidad/generador-asientos", () => ({
  ...jest.requireActual("@/lib/contabilidad/generador-asientos"),
  crearAsiento: jest.fn().mockResolvedValue("cogs-entry-uuid"),
}));

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";
import { crearAsiento } from "@/lib/contabilidad/generador-asientos";

const STORE_ID = "store-uuid-cierre";

function makeRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/contabilidad/cierre-mes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  // Make all chainable methods return the chain itself
  chain.select.mockReturnThis = jest.fn(() => chain);
  chain.eq.mockReturnThis = jest.fn(() => chain);
  chain.gte.mockReturnThis = jest.fn(() => chain);
  chain.lte.mockReturnThis = jest.fn(() => chain);
  chain.in.mockReturnThis = jest.fn(() => chain);
  Object.keys(chain).forEach((k) => {
    if (k !== "single" && typeof chain[k].mockReturnValue === "function") {
      chain[k].mockReturnValue(chain);
    }
  });
  return chain;
}

describe("POST /api/contabilidad/cierre-mes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({
      storeId: STORE_ID,
      userId: "user-001",
    });
  });

  describe("autenticación", () => {
    it("retorna 401 cuando no hay sesión", async () => {
      (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

      const res = await POST(makeRequest({ mes: 4, año: 2026 }));

      expect(res.status).toBe(401);
    });
  });

  describe("validación de body", () => {
    it("retorna 400 cuando falta mes", async () => {
      const mockFrom = jest.fn().mockReturnValue(makeChain());
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

      const res = await POST(makeRequest({ año: 2026 }));

      expect(res.status).toBe(400);
    });

    it("retorna 400 cuando falta año", async () => {
      const mockFrom = jest.fn().mockReturnValue(makeChain());
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

      const res = await POST(makeRequest({ mes: 4 }));

      expect(res.status).toBe(400);
    });

    it("retorna 400 cuando mes está fuera de rango", async () => {
      const mockFrom = jest.fn().mockReturnValue(makeChain());
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

      const res = await POST(makeRequest({ mes: 13, año: 2026 }));

      expect(res.status).toBe(400);
    });

    it("retorna 400 cuando mes es 0", async () => {
      const mockFrom = jest.fn().mockReturnValue(makeChain());
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

      const res = await POST(makeRequest({ mes: 0, año: 2026 }));

      expect(res.status).toBe(400);
    });
  });

  describe("conflicto: cierre ya existe", () => {
    it("retorna 409 cuando ya existe un cierre para ese período", async () => {
      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: "existing-cierre" }, error: null }),
      });
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

      const res = await POST(makeRequest({ mes: 4, año: 2026 }));

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain("2026-04");
    });
  });

  describe("cierre exitoso sin COGS", () => {
    it("retorna 201 con resumen del período", async () => {
      let callCount = 0;
      const mockFrom = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Check cierre existente → no existe
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        // Entries del período
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lte: jest.fn().mockResolvedValue({
            data: [
              { id: "e1", total_debito: 11900, total_credito: 11900 },
              { id: "e2", total_debito: 5950, total_credito: 5950 },
            ],
            error: null,
          }),
        };
      });
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

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
      let callCount = 0;
      const mockFrom = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lte: jest.fn().mockResolvedValue({
            data: [
              { id: "e1", total_debito: 10000, total_credito: 9000 }, // desbalanceado
            ],
            error: null,
          }),
        };
      });
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

      const res = await POST(makeRequest({ mes: 4, año: 2026 }));

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.balanceado).toBe(false);
    });
  });

  describe("cierre con calcular_costo_venta = true", () => {
    it("llama a crearAsiento cuando hay compras con inventario", async () => {
      let callCount = 0;
      const mockFrom = jest.fn().mockImplementation(() => {
        callCount++;

        if (callCount === 1) {
          // Verificar cierre existente
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (callCount === 2) {
          // Entries del período
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockResolvedValue({
              data: [{ id: "e1", total_debito: 11900, total_credito: 11900 }],
              error: null,
            }),
          };
        }
        if (callCount === 3) {
          // Compras del período
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockResolvedValue({
              data: [{ id: "compra-1" }, { id: "compra-2" }],
              error: null,
            }),
          };
        }
        // journal_detail inventario lines
        return {
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({
            data: [{ debito: 5000 }, { debito: 3000 }],
            error: null,
          }),
        };
      });
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

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
      const mockFrom = jest.fn().mockImplementation(() => {
        callCount++;

        if (callCount === 1) {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (callCount === 2) {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            gte: jest.fn().mockReturnThis(),
            lte: jest.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        // Sin compras
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lte: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      });
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

      const res = await POST(makeRequest({ mes: 4, año: 2026, calcular_costo_venta: true }));

      expect(res.status).toBe(201);
      expect(crearAsiento).not.toHaveBeenCalled();
      const body = await res.json();
      expect(body.asientos_cierre).toHaveLength(0);
    });
  });

  describe("respuesta 201 incluye todos los campos de feedback", () => {
    // REGRESIÓN: el cliente necesita mes_cerrado, numero_asientos, balanceado y
    // asientos_cierre para mostrar el panel de resultado; si faltan, el feedback
    // queda vacío aunque la operación haya sido exitosa.
    it("REGRESIÓN: retorna mes_cerrado, numero_asientos, balanceado y asientos_cierre", async () => {
      let callCount = 0;
      const mockFrom = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lte: jest.fn().mockResolvedValue({
            data: [
              { id: "e1", total_debito: 11900, total_credito: 11900 },
              { id: "e2", total_debito: 5950, total_credito: 5950 },
              { id: "e3", total_debito: 2380, total_credito: 2380 },
            ],
            error: null,
          }),
        };
      });
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

      const res = await POST(makeRequest({ mes: 6, año: 2026, calcular_costo_venta: false }));
      expect(res.status).toBe(201);

      const body = await res.json();
      // Todos los campos que el frontend usa para el banner de resultado
      expect(body).toHaveProperty("mes_cerrado", "2026-06");
      expect(body).toHaveProperty("desde", "2026-06-01");
      expect(body).toHaveProperty("hasta", "2026-06-30");
      expect(body).toHaveProperty("numero_asientos", 3);
      expect(body).toHaveProperty("balanceado", true);
      expect(body).toHaveProperty("asientos_cierre");
      expect(Array.isArray(body.asientos_cierre)).toBe(true);
    });

    it("retorna error con status 409 cuando ya existe cierre (feedback de error para la UI)", async () => {
      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: "existing" }, error: null }),
      });
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

      const res = await POST(makeRequest({ mes: 6, año: 2026 }));
      expect(res.status).toBe(409);

      const body = await res.json();
      // El mensaje de error debe ser legible para mostrarlo en el banner de error
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);
    });
  });

  describe("fechas correctas por mes", () => {
    it("calcula correctamente el último día de febrero (año bisiesto)", async () => {
      let callCount = 0;
      const mockFrom = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lte: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      });
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

      const res = await POST(makeRequest({ mes: 2, año: 2024 })); // 2024 es bisiesto
      const body = await res.json();

      expect(body.hasta).toBe("2024-02-29");
    });

    it("calcula correctamente el último día de febrero (año no bisiesto)", async () => {
      let callCount = 0;
      const mockFrom = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lte: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      });
      (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({ from: mockFrom });

      const res = await POST(makeRequest({ mes: 2, año: 2026 }));
      const body = await res.json();

      expect(body.hasta).toBe("2026-02-28");
    });
  });
});
