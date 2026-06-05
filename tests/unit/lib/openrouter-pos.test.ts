/**
 * Tests U-REC-01 a U-REC-04: recomendarProductosEnPOS
 * @jest-environment node
 */
const mockFetch = jest.fn();
global.fetch = mockFetch;

import { recomendarProductosEnPOS } from "@/lib/openrouter";

const CONTEXTO_BASE = {
  items_carrito:     [{ nombre: "Royal Canin Adult", categoria: "Alimento", cantidad: 1 }],
  cliente_nombre:    "Juan",
  mascotas:          [{ nombre: "Firulais", tipo: "perro", raza: "labrador" }],
  historial_reciente: [],
  clima:             { temperatura: 10, descripcion: "nublado", temporada: "invierno" },
  fecha_hoy:         "2026-07-01",
};

const CATALOGO = [
  { nombre: "Antiparasitario Frontline", categoria: "Salud" },
  { nombre: "Snack Dental CET",          categoria: "Accesorios" },
  { nombre: "Manta térmica mediana",     categoria: "Accesorios" },
];

const VALID_LLM_RESPONSE = JSON.stringify([
  { nombre_producto: "Antiparasitario Frontline", razon: "Primavera es temporada de pulgas", urgencia: "alta" },
  { nombre_producto: "Snack Dental CET",          razon: "Higiene dental preventiva",        urgencia: "baja" },
]);

describe("recomendarProductosEnPOS", () => {
  beforeEach(() => jest.clearAllMocks());

  // U-REC-01: incluye HTTP-Referer y Authorization en headers
  it("U-REC-01: llama a OpenRouter con cabeceras correctas", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: VALID_LLM_RESPONSE } }] }),
    });
    await recomendarProductosEnPOS("sk-test", "model", CONTEXTO_BASE, CATALOGO);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ 
          Authorization: "Bearer sk-test",
          "HTTP-Referer": "https://petshop.ammatech.cl",
          "X-Title": "PetShop Recomendador POS"
        }),
      })
    );
  });

  // U-REC-02: retorna máx 3 recomendaciones válidas
  it("U-REC-02: retorna exactamente 2 recomendaciones cuando el LLM da 2", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: VALID_LLM_RESPONSE } }] }),
    });
    const result = await recomendarProductosEnPOS("sk-test", "model", CONTEXTO_BASE, CATALOGO);
    expect(result).toHaveLength(2);
    expect(result[0].nombre_producto).toBe("Antiparasitario Frontline");
  });

  // U-REC-03: descarta entradas con urgencia inválida sin romper las válidas
  it("U-REC-03: descarta entrada con urgencia inválida, conserva válidas", async () => {
    const mixed = JSON.stringify([
      { nombre_producto: "Antiparasitario Frontline", razon: "ok", urgencia: "alta" },
      { nombre_producto: "Manta térmica mediana",     razon: "ok", urgencia: "INVALIDA" },
    ]);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: mixed } }] }),
    });
    const result = await recomendarProductosEnPOS("sk-test", "model", CONTEXTO_BASE, CATALOGO);
    expect(result).toHaveLength(1);
  });

  // U-REC-04: lanza error si el LLM no retorna JSON parseable
  it("U-REC-04: lanza error cuando el LLM devuelve texto no parseable", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Lo siento, no puedo ayudar" } }] }),
    });
    await expect(
      recomendarProductosEnPOS("sk-test", "model", CONTEXTO_BASE, CATALOGO)
    ).rejects.toThrow(/parseable/i);
  });

  // Test adicional: manejo de respuesta con markdown
  it("U-REC-05: limpia bloques markdown de la respuesta", async () => {
    const markdownResponse = JSON.stringify([
      { nombre_producto: "Antiparasario Frontline", razon: "Prueba", urgencia: "alta" }
    ]);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: `\`\`\`json\n${markdownResponse}\n\`\`\`` } }] }),
    });
    const result = await recomendarProductosEnPOS("sk-test", "model", CONTEXTO_BASE, CATALOGO);
    expect(result).toHaveLength(1);
  });

  // Test adicional: límite de 3 recomendaciones
  it("U-REC-06: limita a 3 recomendaciones aunque el LLM devuelva más", async () => {
    const manyResponse = JSON.stringify([
      { nombre_producto: "Prod1", razon: "1", urgencia: "alta" },
      { nombre_producto: "Prod2", razon: "2", urgencia: "media" },
      { nombre_producto: "Prod3", razon: "3", urgencia: "baja" },
      { nombre_producto: "Prod4", razon: "4", urgencia: "alta" },
      { nombre_producto: "Prod5", razon: "5", urgencia: "media" },
    ]);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: manyResponse } }] }),
    });
    const result = await recomendarProductosEnPOS("sk-test", "model", CONTEXTO_BASE, CATALOGO);
    expect(result).toHaveLength(3);
  });
});