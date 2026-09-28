/**
 * Test U-206: accionSaco (src/app/(app)/pos/api.ts) — cliente HTTP que usa el
 * POS para abrir un saco, registrar la merma del resto o deshacer una
 * apertura (§4.6, D18, G2, G6). SearchProductosGranel.test.tsx lo reemplaza
 * por un mock, así que su contrato con POST /api/productos/[id]/saco no se
 * ejecutaba (auditoría de cobertura del 2026-09-26). La autorización real
 * (deshacer solo admin) está en el servidor: productos-saco.test.ts.
 */
import { accionSaco } from "@/app/(app)/pos/api";

const fetchMock = jest.fn();
const fetchOriginal = global.fetch;
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => { global.fetch = fetchOriginal; });

const PROD = "523e4567-e89b-12d3-a456-426614174001";

describe("accionSaco", () => {
  it("U-206: POST JSON a /api/productos/{id}/saco con la acción; OK → resultado; error → mensaje del servidor o 'Error {status}' (también sin cuerpo JSON)", async () => {
    const resultado = { saco: { id: "s1", gramos_iniciales: 15000, gramos_restantes: 15000 }, stock: 3 };
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => resultado });
    await expect(accionSaco(PROD, { accion: "abrir", nota: "saco nuevo" })).resolves.toEqual(resultado);
    expect(fetchMock).toHaveBeenCalledWith(`/api/productos/${PROD}/saco`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "abrir", nota: "saco nuevo" }),
    });

    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: "Saco abierto con gramos restantes" }) });
    await expect(accionSaco(PROD, { accion: "abrir" })).rejects.toThrow("Saco abierto con gramos restantes");

    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    await expect(accionSaco(PROD, { accion: "deshacer" })).rejects.toThrow("Error 403");

    // Respuesta no-JSON (ej. página de error del proxy): no revienta con un SyntaxError.
    // 5xx: mensaje genérico del helper compartido (lib/api-client, QA 2026-09-27).
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new SyntaxError("Unexpected token <"); } });
    await expect(accionSaco(PROD, { accion: "merma", motivo: "Resto húmedo" })).rejects.toThrow("Error del servidor. Intenta de nuevo en unos momentos.");
  });
});
