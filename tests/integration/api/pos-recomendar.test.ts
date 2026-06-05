/**
 * Tests I-POS-01 a I-POS-07: POST /api/ai/pos/recomendar
 * @jest-environment node
 */

const STORE_ID    = "123e4567-e89b-12d3-a456-426614174000";
const CLIENTE_ID  = "223e4567-e89b-12d3-a456-426614174001";
const PRODUCTO_ID = "323e4567-e89b-12d3-a456-426614174002";

const mockGetStoreId = jest.fn();
const mockFrom       = jest.fn();
const mockClimatico  = jest.fn();
const mockRecomendarPOS = jest.fn();

jest.mock("@/lib/auth",        () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase",    () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("@/lib/weather",     () => ({ obtenerContextoClimatico: mockClimatico }));
jest.mock("@/lib/openrouter",  () => ({ recomendarProductosEnPOS: mockRecomendarPOS }));
jest.mock("@/lib/audit",       () => ({
  logAudit:           jest.fn().mockResolvedValue(undefined),
  getRequestMetadata: jest.fn().mockResolvedValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

import { NextRequest }  from "next/server";
import { POST }         from "@/app/api/ai/pos/recomendar/route";

const MOCK_CLIMA = { temperatura: 10, descripcion: "nublado", temporada: "invierno", esFrio: true, esCalido: false };
const MOCK_RECS  = [{ nombre_producto: "Antiparasitario Frontline", razon: "Invierno", urgencia: "alta" }];

function makeRequest(body = {}) {
  return new NextRequest("http://localhost/api/ai/pos/recomendar", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemsCarrito: [{ producto_id: PRODUCTO_ID, nombre: "Royal Canin" }], ...body }),
  });
}

// Helper para mockear el cliente Supabase con respuestas por tabla
function setupSupabase(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    stores: { data: { openrouter_model: "z-ai/glm-4.5-air:free", ciudad: "Santiago" }, error: null },
    productos: { data: [{ id: PRODUCTO_ID, nombre: "Royal Canin", precio: 25000, categoria_id: null }], error: null },
    categorias: { data: [], error: null },
    ai_pos_cache: { data: null, error: null },        // cache miss por defecto
    ventas: { data: [], error: null },
    clientes: { data: { nombre: "Juan" }, error: null },
    mascotas: { data: [], error: null },
    ...overrides,
  };

  mockFrom.mockImplementation((table: string) => {
    const resp = defaults[table] ?? { data: null, error: null };
    const builder: Record<string, jest.Mock> = {};
    const chain = () => new Proxy({}, {
      get: (_t, prop: string) => {
        if (prop === "then") return undefined;
        return () => chain();
      },
    });
    // Simplificado: devuelve un objeto que termina con single/limit/gte/etc.
    return buildChain(resp);
  });
}

function buildChain(resp: unknown) {
  // El Proxy intercepta TODA lectura de props, incluyendo "then".
  // Para que sea awaitable, "then" debe devolver la función real de Promise.
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
          Promise.resolve(resp).then(resolve, reject);
      }
      if (prop === "catch") {
        return (fn: (e: unknown) => void) => Promise.resolve(resp).catch(fn);
      }
      // Cualquier método de encadenamiento devuelve el mismo proxy
      return () => proxy;
    },
  });
  return proxy;
}

describe("POST /api/ai/pos/recomendar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENROUTER_API_KEY = "sk-test";
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockClimatico.mockResolvedValue(MOCK_CLIMA);
    mockRecomendarPOS.mockResolvedValue(MOCK_RECS);
  });

  afterEach(() => { delete process.env.OPENROUTER_API_KEY; });

  // I-POS-01: sin auth → 401
  it("I-POS-01: retorna 401 sin autenticación", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  // I-POS-02: sin API key → 503
  it("I-POS-02: retorna 503 si OPENROUTER_API_KEY no está configurada", async () => {
    delete process.env.OPENROUTER_API_KEY;
    setupSupabase();
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
  });

  // I-POS-03: sin clienteId → responde con recs genéricas (solo carrito + clima)
  it("I-POS-03: retorna 200 sin clienteId usando solo carrito + clima", async () => {
    setupSupabase();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockRecomendarPOS).toHaveBeenCalled();
  });

  // I-POS-04: cache hit → no llama al LLM
  it("I-POS-04: retorna recomendaciones desde cache sin llamar al LLM", async () => {
    setupSupabase({
      ai_pos_cache: { data: { recomendaciones: MOCK_RECS }, error: null },
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("HIT");
    expect(mockRecomendarPOS).not.toHaveBeenCalled();
  });

  // I-POS-05: cache miss → llama al LLM y retorna recs
  it("I-POS-05: llama al LLM en cache miss y retorna recomendaciones", async () => {
    setupSupabase();
    const res = await POST(makeRequest({ clienteId: CLIENTE_ID }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Cache")).toBe("MISS");
    expect(mockRecomendarPOS).toHaveBeenCalled();
    const body = await res.json();
    expect(body.recomendaciones).toBeDefined();
  });

  // I-POS-06: LLM lanza error → 502
  it("I-POS-06: retorna 502 cuando el LLM falla", async () => {
    setupSupabase();
    mockRecomendarPOS.mockRejectedValue(new Error("API key inválida"));
    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("API key inválida");
  });

  // I-POS-07: producto ya en carrito es excluido del resultado
  it("I-POS-07: excluye del resultado productos que ya están en el carrito", async () => {
    setupSupabase();
    // LLM sugiere el mismo producto que ya está en el carrito
    mockRecomendarPOS.mockResolvedValue([
      { nombre_producto: "Royal Canin", razon: "test", urgencia: "alta" },
    ]);
    const res = await POST(makeRequest({ itemsCarrito: [{ producto_id: PRODUCTO_ID, nombre: "Royal Canin" }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recomendaciones).toHaveLength(0);
  });

  // Test adicional: audit logging (usa el mock registrado al inicio del archivo)
  it("I-POS-08: llama a logAudit con parámetros correctos", async () => {
    const { logAudit } = jest.requireMock("@/lib/audit") as { logAudit: jest.Mock };
    setupSupabase();
    const res = await POST(makeRequest({ clienteId: CLIENTE_ID }));
    expect(res.status).toBe(200);
    // logAudit es fire-and-forget: esperamos al siguiente tick para que se ejecute
    await new Promise((r) => setTimeout(r, 10));
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "AI_RECOMMENDATION",
        entityType: "pos_recommender",
      })
    );
  });

  // Test adicional: manejo de mascotaId específico
  it("I-POS-09: filtra mascotas por mascotaId cuando se especifica", async () => {
    const MASCOTA_ID = "423e4567-e89b-12d3-a456-426614174003"; // UUID válido
    setupSupabase({
      mascotas: { data: [{ id: MASCOTA_ID, nombre: "Firulais", tipo: "perro", raza: "labrador", peso_kg: 25, alimento_habitual_id: PRODUCTO_ID }], error: null },
    });
    const res = await POST(makeRequest({ clienteId: CLIENTE_ID, mascotaId: MASCOTA_ID }));
    expect(res.status).toBe(200);
    expect(mockRecomendarPOS).toHaveBeenCalled();
  });
});