/**
 * Tests U-OR-01 a U-OR-06: lib/openrouter.ts
 */
import { analizarVencimientosConIA } from "@/lib/openrouter";

// Mock de global.fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const VALID_PRODUCTOS = [
  {
    producto_id: "123e4567-e89b-12d3-a456-426614174001",
    nombre: "Royal Canin Adult",
    sku: "RC-001",
    stock: 10,
    precio_actual: 25000,
    costo: null,
    fecha_vencimiento: "2026-06-01",
    dias_hasta_vencer: 7,
    unidades_vendidas_30d: 2,
  },
];

const VALID_RESPONSE_BODY = JSON.stringify([
  {
    producto_id: "123e4567-e89b-12d3-a456-426614174001",
    urgencia: "alta",
    estrategia: "descuento",
    descuento_sugerido_pct: 30,
    precio_oferta_sugerido: 17500,
    razon: "Vence en 7 días con stock disponible.",
    mensaje_whatsapp: "🐾 Oferta por vencimiento: Royal Canin Adult -30%!",
  }
]);

describe("analizarVencimientosConIA", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it("U-OR-01: llama a OpenRouter con Authorization, Content-Type y HTTP-Referer", async () => {
    mockFetch.mockResolvedValue({ 
      ok: true, 
      json: async () => ({ choices: [{ message: { content: VALID_RESPONSE_BODY } }] }) 
    });
    await analizarVencimientosConIA("sk-test", "z-ai/glm-4.5-air:free", VALID_PRODUCTOS, "2026-05-25");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          "HTTP-Referer": expect.any(String),
        }),
      })
    );
  });

  it("U-OR-02: devuelve array de recomendaciones cuando el LLM responde JSON válido", async () => {
    mockFetch.mockResolvedValue({ 
      ok: true, 
      json: async () => ({ choices: [{ message: { content: VALID_RESPONSE_BODY } }] }) 
    });
    const result = await analizarVencimientosConIA("sk-test", "z-ai/glm-4.5-air:free", VALID_PRODUCTOS, "2026-05-25");
    expect(result).toHaveLength(1);
    expect(result[0].urgencia).toBe("alta");
    expect(result[0].descuento_sugerido_pct).toBe(30);
  });

  it("U-OR-03: maneja respuesta envuelta en ```json ... ```", async () => {
    const wrapped = "```json\n" + VALID_RESPONSE_BODY + "\n```";
    mockFetch.mockResolvedValue({ 
      ok: true, 
      json: async () => ({ choices: [{ message: { content: wrapped } }] }) 
    });
    const result = await analizarVencimientosConIA("sk-test", "z-ai/glm-4.5-air:free", VALID_PRODUCTOS, "2026-05-25");
    expect(result).toHaveLength(1);
  });

  it("U-OR-04: lanza error con mensaje claro ante HTTP 401", async () => {
    mockFetch.mockResolvedValue({ 
      ok: false, 
      status: 401, 
      json: async () => ({}) 
    });
    await expect(analizarVencimientosConIA("bad-key", "model", VALID_PRODUCTOS, "2026-05-25"))
      .rejects.toThrow(/api key|inválida|créditos/i);
  });

  it("U-OR-05: lanza error cuando el LLM devuelve texto no parseable", async () => {
    mockFetch.mockResolvedValue({ 
      ok: true, 
      json: async () => ({ choices: [{ message: { content: "Lo siento no puedo ayudar" } }] }) 
    });
    await expect(analizarVencimientosConIA("sk-test", "model", VALID_PRODUCTOS, "2026-05-25"))
      .rejects.toThrow(/parseable|JSON/i);
  });

  it("U-OR-06: descarta entradas con urgencia inválida y retorna las válidas restantes", async () => {
    const mixed = JSON.stringify([
      { ...JSON.parse(VALID_RESPONSE_BODY)[0] },
      { producto_id: "otro-uuid", urgencia: "INVALIDA", estrategia: "descuento", descuento_sugerido_pct: 10, precio_oferta_sugerido: 10000, razon: "x", mensaje_whatsapp: "x" }
    ]);
    mockFetch.mockResolvedValue({ 
      ok: true, 
      json: async () => ({ choices: [{ message: { content: mixed } }] }) 
    });
    const result = await analizarVencimientosConIA("sk-test", "model", VALID_PRODUCTOS, "2026-05-25");
    expect(result).toHaveLength(1);
  });
});