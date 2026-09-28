/**
 * U-217 (QA 2026-09-27): las llamadas del POS distinguen un 429 de "sin
 * datos". getProductos/getClienteByRUT/getMascotasByCliente/accionSaco usan
 * fetchJson; createVenta lanza ApiError con el Retry-After y NUNCA devuelve
 * una venta cuando la API respondió 429.
 */
import { ApiError } from "@/lib/api-client";
import { createVenta, getClienteByRUT, getMascotasByCliente, getProductos, accionSaco } from "@/app/(app)/pos/api";

const fetchMock = jest.fn();
const original = global.fetch;
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => { global.fetch = original; });

const r429 = () => ({
  ok: false,
  status: 429,
  headers: new Headers({ "Retry-After": "42", "content-type": "application/json" }),
  json: async () => ({ error: "Too many requests. Please try again later." }),
});
const MSG = "Demasiadas solicitudes. Reintenta en 42 s.";

describe("POS api ante 429 (U-217)", () => {
  it.each([
    ["getProductos", () => getProductos("alimento")],
    ["getClienteByRUT", () => getClienteByRUT("11111111-1")],
    ["getMascotasByCliente", () => getMascotasByCliente("cli-1")],
    ["accionSaco", () => accionSaco("p1", { accion: "abrir" })],
  ])("U-217: %s → ApiError 429 con Retry-After, nunca datos vacíos", async (_n, llamar) => {
    fetchMock.mockResolvedValueOnce(r429());
    const err = await (llamar as () => Promise<unknown>)().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.retryAfterSeg).toBe(42);
    expect(err.message).toBe(MSG);
  });

  it("U-217: createVenta con 429 rechaza con el mensaje (la venta no se da por hecha)", async () => {
    fetchMock.mockResolvedValueOnce(r429());
    await expect(
      createVenta({ items: [], metodoPago: "efectivo", descuentoPct: 0, procedencia: "tienda", idempotencyKey: "k-1" })
    ).rejects.toMatchObject({ status: 429, message: MSG });
  });

  it("U-217: getProductos con 200 sigue devolviendo la lista", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => [{ id: "p1" }] });
    await expect(getProductos("")).resolves.toEqual([{ id: "p1" }]);
  });
});
