/**
 * Tests I-AI-01 a I-AI-09: POST /api/ai/vencimientos/optimizar + GET
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174010";
const HALLUCINATED_ID = "00000000-0000-0000-0000-000000000001";

const mockFrom = jest.fn();
const mockGetStoreId = jest.fn();
const mockAuth = jest.fn();
const mockAnalizarIA = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("@/lib/openrouter", () => ({ analizarVencimientosConIA: mockAnalizarIA }));
jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
jest.mock("@/lib/audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  getRequestMetadata: jest.fn().mockResolvedValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

import { POST, GET } from "@/app/api/ai/vencimientos/optimizar/route";

// Fixture de producto DB
const DB_PRODUCTO = {
  id: PRODUCTO_ID, nombre: "Royal Canin", sku: "RC-001",
  stock: 5, precio: 25000, costo: null,
  fecha_vencimiento: "2026-06-01",
};

const DB_RECOMENDACION = {
  producto_id: PRODUCTO_ID, urgencia: "alta", estrategia: "descuento",
  descuento_sugerido_pct: 30, precio_oferta_sugerido: 17500,
  razon: "Vence en 7 días.", mensaje_whatsapp: "Oferta 30% off!",
};

function makeRequest(body = {}) {
  return new NextRequest("http://localhost/api/ai/vencimientos/optimizar", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Setup de mocks para storeAdmin
function setupStoreAdmin() {
  mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  mockAuth.mockResolvedValue({
    sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
  });
  process.env.OPENROUTER_API_KEY = "sk-test-key";
}

describe("POST /api/ai/vencimientos/optimizar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.OPENROUTER_API_KEY;
  });

  // I-AI-01
  it("I-AI-01: rechaza no autenticado con 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  // I-AI-02
  it("I-AI-02: rechaza storeWorker con 403", async () => {
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({
      sessionClaims: { publicMetadata: { storeWorker: true, storeId: STORE_ID } },
    });
    process.env.OPENROUTER_API_KEY = "sk-test";
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
  });

  // I-AI-03
  it("I-AI-03: retorna 503 si OPENROUTER_API_KEY no está configurada", async () => {
    setupStoreAdmin();
    // no configurar env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY;
    // mock stores para que no falle en la query
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { openrouter_model: null }, error: null }),
    }));
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
  });

  // I-AI-04: sin productos próximos a vencer → respuesta vacía
  it("I-AI-04: retorna recomendaciones vacías si no hay productos próximos a vencer", async () => {
    setupStoreAdmin();
    mockFrom.mockImplementation((table: string) => {
      if (table === "stores") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { openrouter_model: null }, error: null }),
      };
      if (table === "productos") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(), lte: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(), order: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), gte: jest.fn().mockResolvedValue({ data: [], error: null }) };
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recomendaciones).toHaveLength(0);
    expect(mockAnalizarIA).not.toHaveBeenCalled();
  });

  // I-AI-05: flujo exitoso
  it("I-AI-05: llama a analizarVencimientosConIA y retorna recomendaciones", async () => {
    setupStoreAdmin();
    mockAnalizarIA.mockResolvedValue([DB_RECOMENDACION]);
    mockFrom.mockImplementation((table: string) => {
      if (table === "stores") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { openrouter_model: "z-ai/glm-4.5-air:free" }, error: null }),
      };
      if (table === "productos") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(), lte: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }),
      };
      // venta_items
      return {
        select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(),
        gte: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });
    const res = await POST(makeRequest({ diasAlerta: 30 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recomendaciones).toHaveLength(1);
    expect(body.recomendaciones[0].urgencia).toBe("alta");
    expect(body.modelo_usado).toBe("z-ai/glm-4.5-air:free");
  });

  // I-AI-06: velocidad de ventas incluida en datos al LLM
  it("I-AI-06: incluye unidades_vendidas_30d calculadas correctamente", async () => {
    setupStoreAdmin();
    mockAnalizarIA.mockResolvedValue([]);
    mockFrom.mockImplementation((table: string) => {
      if (table === "stores") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { openrouter_model: null }, error: null }),
      };
      if (table === "productos") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(), lte: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }),
      };
      // venta_items: 3 unidades vendidas
      return {
        select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(),
        gte: jest.fn().mockResolvedValue({
          data: [{ producto_id: PRODUCTO_ID, cantidad: 2 }, { producto_id: PRODUCTO_ID, cantidad: 1 }],
          error: null,
        }),
      };
    });
    await POST(makeRequest());
    expect(mockAnalizarIA).toHaveBeenCalledWith(
      expect.any(String), expect.any(String),
      expect.arrayContaining([expect.objectContaining({ unidades_vendidas_30d: 3 })]),
      expect.any(String),
    );
  });

  // I-AI-07: error del LLM → 502
  it("I-AI-07: retorna 502 si el LLM lanza error", async () => {
    setupStoreAdmin();
    mockAnalizarIA.mockRejectedValue(new Error("API key inválida"));
    mockFrom.mockImplementation((table: string) => {
      if (table === "stores") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { openrouter_model: null }, error: null }),
      };
      if (table === "productos") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(), lte: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }),
      };
      return {
        select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(),
        gte: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("API key inválida");
  });

  // I-AI-08: filtra producto_id que LLM alucinó (no existe en input)
  it("I-AI-08: filtra recomendaciones con producto_id que no existe en los productos analizados", async () => {
    setupStoreAdmin();
    const HALLUCINATED = {
      producto_id: HALLUCINATED_ID, urgencia: "alta", estrategia: "descuento",
      descuento_sugerido_pct: 50, precio_oferta_sugerido: 5000,
      razon: "Producto inventado", mensaje_whatsapp: "Oferta!",
    };
    mockAnalizarIA.mockResolvedValue([DB_RECOMENDACION, HALLUCINATED]);
    mockFrom.mockImplementation((table: string) => {
      if (table === "stores") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { openrouter_model: null }, error: null }),
      };
      if (table === "productos") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(), lte: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }),
      };
      return {
        select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(),
        gte: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recomendaciones).toHaveLength(1);
    expect(body.recomendaciones[0].producto_id).toBe(PRODUCTO_ID);
  });

  // I-AI-10: cold-start transitorio — reintenta una vez y el segundo intento tiene éxito
  it("I-AI-10: reintenta una vez cuando el primer intento hace timeout y el segundo responde", async () => {
    jest.useFakeTimers();
    setupStoreAdmin();
    mockAnalizarIA
      .mockRejectedValueOnce(new Error("OpenRouter no respondió a tiempo. Intente de nuevo."))
      .mockResolvedValueOnce([DB_RECOMENDACION]);
    mockFrom.mockImplementation((table: string) => {
      if (table === "stores") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { openrouter_model: null }, error: null }),
      };
      if (table === "productos") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(), lte: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }),
      };
      return {
        select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(),
        gte: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    const resPromise = POST(makeRequest());
    await jest.advanceTimersByTimeAsync(2000); // espera entre reintentos
    const res = await resPromise;

    expect(mockAnalizarIA).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recomendaciones).toHaveLength(1);
    jest.useRealTimers();
  });

  // I-AI-11: ambos intentos hacen timeout → 502, sin reintentos infinitos
  it("I-AI-11: retorna 502 si ambos intentos (original + reintento) hacen timeout", async () => {
    jest.useFakeTimers();
    setupStoreAdmin();
    mockAnalizarIA.mockRejectedValue(new Error("OpenRouter no respondió a tiempo. Intente de nuevo."));
    mockFrom.mockImplementation((table: string) => {
      if (table === "stores") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { openrouter_model: null }, error: null }),
      };
      if (table === "productos") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(), lte: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }),
      };
      return {
        select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(),
        gte: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    const resPromise = POST(makeRequest());
    await jest.advanceTimersByTimeAsync(2000);
    const res = await resPromise;

    expect(mockAnalizarIA).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("no respondió a tiempo");
    jest.useRealTimers();
  });

  // I-AI-12: error no relacionado a timeout (ej. API key inválida) no dispara reintento
  it("I-AI-12: no reintenta cuando el error no es de timeout", async () => {
    setupStoreAdmin();
    mockAnalizarIA.mockRejectedValue(new Error("API key inválida o sin créditos"));
    mockFrom.mockImplementation((table: string) => {
      if (table === "stores") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { openrouter_model: null }, error: null }),
      };
      if (table === "productos") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(), lte: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }),
      };
      return {
        select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(),
        gte: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    const res = await POST(makeRequest());

    expect(mockAnalizarIA).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("API key inválida");
  });
});

describe("GET /api/ai/vencimientos/optimizar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // I-AI-09: filtra productos inactivos/eliminados del cache
  it("I-AI-09: GET filtra recomendaciones cacheadas de productos inactivos y reporta productos_obsoletos", async () => {
    const ACTIVE_ID   = "a0000000-0000-0000-0000-000000000001";
    const INACTIVE_ID = "b0000000-0000-0000-0000-000000000002";

    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });

    const hoy = new Date();
    const diasRestantes = Math.floor(
      (new Date("2026-07-20").getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)
    );

    mockFrom.mockImplementation((table: string) => {
      if (table === "ai_vencimientos_analisis") return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            recomendaciones: [
              { producto_id: ACTIVE_ID, nombre: "Activo", sku: "A-01", dias_hasta_vencer: 10, stock: 5, precio_actual: 1000, descuento_recomendado: 20, motivo: "Vence pronto" },
              { producto_id: INACTIVE_ID, nombre: "Inactivo", sku: "I-01", dias_hasta_vencer: 3, stock: 2, precio_actual: 2000, descuento_recomendado: 30, motivo: "Urgente" },
            ],
            modelo_usado: "test-model",
            productos_analizados: 2,
            created_at: "2026-06-01T00:00:00Z",
            dias_alerta: 30,
          },
          error: null,
        }),
      };
      if (table === "productos") return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [
            { id: ACTIVE_ID, activo: true, stock: 8, fecha_vencimiento: "2026-07-20" },
            { id: INACTIVE_ID, activo: false, stock: 2, fecha_vencimiento: "2026-06-17" },
          ],
          error: null,
        }),
      };
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), gte: jest.fn().mockResolvedValue({ data: [], error: null }) };
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    // Solo el producto activo debe permanecer
    expect(body.recomendaciones).toHaveLength(1);
    expect(body.recomendaciones[0].producto_id).toBe(ACTIVE_ID);
    // El stock debe venir de la query actual, no del cache
    expect(body.recomendaciones[0].stock).toBe(8);
    // dias_hasta_vencer debe recalcularse desde fecha real
    expect(body.recomendaciones[0].dias_hasta_vencer).toBe(diasRestantes);
    // Debe reportar cuántos fueron omitidos
    expect(body.productos_obsoletos).toBe(1);
  });
});