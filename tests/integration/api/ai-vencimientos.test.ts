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

  // I-AI-18: POST persiste fecha_vencimiento junto a cada recomendación
  // guardada, para que GET pueda detectar más adelante si el producto
  // cambió desde el análisis (nuevo lote, restock).
  it("I-AI-18: POST persiste fecha_vencimiento del producto en cada recomendación guardada", async () => {
    setupStoreAdmin();
    mockAnalizarIA.mockResolvedValue([DB_RECOMENDACION]);
    const mockInsert = jest.fn().mockResolvedValue({ data: null, error: null });
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
      if (table === "ai_vencimientos_analisis") return { insert: mockInsert };
      // venta_items
      return {
        select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(),
        gte: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    const res = await POST(makeRequest({ diasAlerta: 30 }));
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        recomendaciones: expect.arrayContaining([
          expect.objectContaining({
            producto_id: PRODUCTO_ID,
            fecha_vencimiento: DB_PRODUCTO.fecha_vencimiento,
          }),
        ]),
      })
    );
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

  // I-AI-13: REGRESIÓN — producto activo pero sin fecha_vencimiento (se
  // desactivó el seguimiento de vencimiento después del análisis cacheado)
  // debe tratarse como obsoleto, igual que uno inactivo — la premisa "esto
  // vence pronto" ya no tiene base real. Caso real verificado en producción
  // (26-05-2026): "Alimento Perro Pro Plan 3kg" quedó con activo=false;
  // este test cubre la variante donde en cambio se limpia fecha_vencimiento
  // manteniendo el producto activo.
  it("I-AI-13: GET trata como obsoleta una recomendación de un producto activo sin fecha_vencimiento", async () => {
    const SIN_VENCIMIENTO_ID = "c0000000-0000-0000-0000-000000000003";

    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "ai_vencimientos_analisis") return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            recomendaciones: [
              { producto_id: SIN_VENCIMIENTO_ID, nombre: "Pro Plan 3kg", sku: "DOG002", dias_hasta_vencer: 21, stock: 80, precio_actual: 61870, descuento_recomendado: 20, motivo: "Vence pronto" },
            ],
            modelo_usado: "test-model",
            productos_analizados: 1,
            created_at: "2026-05-26T05:18:12Z",
            dias_alerta: 30,
          },
          error: null,
        }),
      };
      if (table === "productos") return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        // Producto sigue activo, pero ya no tiene fecha_vencimiento (se
        // desactivó el seguimiento) — fecha_vencimiento: null.
        in: jest.fn().mockResolvedValue({
          data: [
            { id: SIN_VENCIMIENTO_ID, activo: true, stock: 80, fecha_vencimiento: null },
          ],
          error: null,
        }),
      };
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), gte: jest.fn().mockResolvedValue({ data: [], error: null }) };
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.recomendaciones).toHaveLength(0);
    expect(body.productos_obsoletos).toBe(1);
  });

  // I-AI-14: REGRESIÓN — el texto de la recomendación (razon, mensaje_whatsapp,
  // urgencia) no se regenera al servir la caché; GET solo refresca Días/Stock
  // contra el catálogo actual. Si el stock cambió desde el análisis (venta,
  // restock, ajuste) mientras el producto sigue activo con la misma
  // fecha_vencimiento, el texto ya no describe esos números — GET debe
  // marcar datos_desactualizados=true para que el frontend lo señale en vez
  // de mostrar ambos sin aviso. Repro real: texto "vence en 1 día, 90
  // unidades" junto a columnas Días=105/Stock=101 sin ninguna indicación de
  // que el texto es del análisis original.
  it("I-AI-14: REGRESIÓN — GET marca datos_desactualizados=true cuando el stock cambió desde el análisis", async () => {
    const PROD_ID = "d0000000-0000-0000-0000-000000000004";
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "ai_vencimientos_analisis") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            recomendaciones: [
              {
                producto_id: PROD_ID, urgencia: "alta", estrategia: "descuento",
                descuento_sugerido_pct: 30, precio_oferta_sugerido: 17500,
                razon: "Vence en 1 día, quedan 90 unidades.", mensaje_whatsapp: "Oferta!",
                dias_hasta_vencer: 1, stock: 90, fecha_vencimiento: "2026-07-18",
              },
            ],
            modelo_usado: "test-model", productos_analizados: 1,
            created_at: "2026-07-17T00:00:00Z", dias_alerta: 30,
          },
          error: null,
        }),
      };
      if (table === "productos") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [{ id: PROD_ID, activo: true, stock: 101, fecha_vencimiento: "2026-07-18" }],
          error: null,
        }),
      };
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), gte: jest.fn().mockResolvedValue({ data: [], error: null }) };
    });

    const res = await GET();
    const body = await res.json();

    expect(body.recomendaciones).toHaveLength(1);
    expect(body.recomendaciones[0].stock).toBe(101); // columna en vivo
    expect(body.recomendaciones[0].razon).toBe("Vence en 1 día, quedan 90 unidades."); // texto sin regenerar
    expect(body.recomendaciones[0].datos_desactualizados).toBe(true);
  });

  // I-AI-15: REGRESIÓN — mismo mecanismo, disparado por un cambio de
  // fecha_vencimiento (ej. nuevo lote reemplazó el que estaba por vencer)
  // en vez de un cambio de stock.
  it("I-AI-15: REGRESIÓN — GET marca datos_desactualizados=true cuando fecha_vencimiento cambió desde el análisis (nuevo lote)", async () => {
    const PROD_ID = "e0000000-0000-0000-0000-000000000005";
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "ai_vencimientos_analisis") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            recomendaciones: [
              {
                producto_id: PROD_ID, urgencia: "alta", estrategia: "descuento",
                descuento_sugerido_pct: 30, precio_oferta_sugerido: 17500,
                razon: "Vence en 1 día.", mensaje_whatsapp: "Oferta!",
                dias_hasta_vencer: 1, stock: 90, fecha_vencimiento: "2026-07-18",
              },
            ],
            modelo_usado: "test-model", productos_analizados: 1,
            created_at: "2026-07-17T00:00:00Z", dias_alerta: 30,
          },
          error: null,
        }),
      };
      if (table === "productos") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          // Stock igual al cacheado, pero fecha_vencimiento se extendió: llegó
          // un nuevo lote y reemplazó el que estaba por vencer.
          data: [{ id: PROD_ID, activo: true, stock: 90, fecha_vencimiento: "2026-10-30" }],
          error: null,
        }),
      };
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), gte: jest.fn().mockResolvedValue({ data: [], error: null }) };
    });

    const res = await GET();
    const body = await res.json();

    expect(body.recomendaciones[0].datos_desactualizados).toBe(true);
  });

  // I-AI-16: caso feliz — sin drift, no debe marcarse la fila.
  it("I-AI-16: GET no marca datos_desactualizados cuando stock y fecha_vencimiento coinciden con el análisis cacheado", async () => {
    const PROD_ID = "f0000000-0000-0000-0000-000000000006";
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "ai_vencimientos_analisis") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            recomendaciones: [
              {
                producto_id: PROD_ID, urgencia: "alta", estrategia: "descuento",
                descuento_sugerido_pct: 30, precio_oferta_sugerido: 17500,
                razon: "Vence pronto.", mensaje_whatsapp: "Oferta!",
                dias_hasta_vencer: 1, stock: 90, fecha_vencimiento: "2026-07-18",
              },
            ],
            modelo_usado: "test-model", productos_analizados: 1,
            created_at: "2026-07-17T00:00:00Z", dias_alerta: 30,
          },
          error: null,
        }),
      };
      if (table === "productos") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [{ id: PROD_ID, activo: true, stock: 90, fecha_vencimiento: "2026-07-18" }],
          error: null,
        }),
      };
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), gte: jest.fn().mockResolvedValue({ data: [], error: null }) };
    });

    const res = await GET();
    const body = await res.json();

    expect(body.recomendaciones[0].datos_desactualizados).toBe(false);
  });

  // I-AI-17: compatibilidad hacia atrás — un análisis persistido ANTES de
  // este fix no tiene fecha_vencimiento en su JSON cacheado. GET no debe
  // generar un falso positivo comparando contra un valor inexistente; solo
  // el drift de stock sigue siendo detectable para esas filas antiguas.
  it("I-AI-17: análisis cacheado sin fecha_vencimiento persistida (previo a este fix) no genera falso positivo por fecha", async () => {
    const PROD_ID = "10000000-0000-0000-0000-000000000007";
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "ai_vencimientos_analisis") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            recomendaciones: [
              // Sin fecha_vencimiento — simula un análisis persistido antes de este fix.
              {
                producto_id: PROD_ID, urgencia: "alta", estrategia: "descuento",
                descuento_sugerido_pct: 30, precio_oferta_sugerido: 17500,
                razon: "Vence pronto.", mensaje_whatsapp: "Oferta!",
                dias_hasta_vencer: 1, stock: 90,
              },
            ],
            modelo_usado: "test-model", productos_analizados: 1,
            created_at: "2026-07-17T00:00:00Z", dias_alerta: 30,
          },
          error: null,
        }),
      };
      if (table === "productos") return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          // fecha_vencimiento actual difiere de cualquier valor supuesto, pero
          // como el cache no la registró, no debe compararse ni marcar drift.
          data: [{ id: PROD_ID, activo: true, stock: 90, fecha_vencimiento: "2026-12-25" }],
          error: null,
        }),
      };
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), gte: jest.fn().mockResolvedValue({ data: [], error: null }) };
    });

    const res = await GET();
    const body = await res.json();

    expect(body.recomendaciones[0].datos_desactualizados).toBe(false);
  });
});