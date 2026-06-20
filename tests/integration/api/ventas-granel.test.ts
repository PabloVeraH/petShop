/**
 * Tests GR-I-05, GR-I-07, GR-U-01/02: Precio granel — propagación frontend→backend
 *
 * Verifica que el mapeo de items en createVenta() (pos/api.ts) propaga
 * es_granel y gramos al body del request, sin los cuales el backend
 * usaría precio de lista en vez de precio_venta_kg (bug reportado).
 */

global.fetch = jest.fn();

import { createVenta } from "@/app/(app)/pos/api";

const PRODUCTO_ID = "prod-granel-001";

function mockFetchOk(response: object) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    headers: { get: () => "application/json" },
    json: () => Promise.resolve(response),
  });
}

function captureBody(): Promise<object> {
  return new Promise((resolve) => {
    (global.fetch as jest.Mock).mockImplementationOnce((_url: string, opts: RequestInit) => {
      resolve(JSON.parse(opts.body as string));
      return Promise.resolve({
        ok: true,
        headers: { get: () => "application/json" },
        json: () => Promise.resolve({ id: "venta-1", total: 8000 }),
      });
    });
  });
}

describe("createVenta — propagación es_granel al backend", () => {
  beforeEach(() => jest.clearAllMocks());

  // GR-U-01: es_granel y gramos llegan al body del request
  it("GR-U-01: es_granel:true y gramos se incluyen en el body enviado a POST /api/ventas", async () => {
    const bodyPromise = captureBody();

    createVenta({
      items: [{
        producto_id: PRODUCTO_ID,
        cantidad: 0.8,
        precio_unitario: 10000,
        subtotal: 8000,
        es_granel: true,
        gramos: 800,
      }],
      metodoPago: "efectivo",
      descuentoPct: 0,
      procedencia: "presencial",
    });

    const body = await bodyPromise;
    expect(body).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ es_granel: true, gramos: 800 }),
      ]),
    });
  });

  // GR-U-02: item normal (sin granel) no incluye es_granel ni gramos
  it("GR-U-02: item normal sin es_granel envía es_granel:undefined al backend", async () => {
    const bodyPromise = captureBody();

    createVenta({
      items: [{
        producto_id: PRODUCTO_ID,
        cantidad: 1,
        precio_unitario: 56000,
        subtotal: 56000,
      }],
      metodoPago: "efectivo",
      descuentoPct: 0,
      procedencia: "presencial",
    });

    const body = await bodyPromise as { items: Array<{ es_granel?: boolean }> };
    expect(body.items[0].es_granel).toBeUndefined();
  });

  // GR-I-05: error HTTP retorna mensaje legible (no crash por JSON.parse de HTML)
  it("GR-I-05: error 500 con content-type JSON lanza Error con mensaje del servidor", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => "application/json" },
      json: () => Promise.resolve({ error: "Stock insuficiente" }),
    });

    await expect(
      createVenta({
        items: [{ producto_id: PRODUCTO_ID, cantidad: 0.5, precio_unitario: 10000, subtotal: 5000, es_granel: true }],
        metodoPago: "efectivo",
        descuentoPct: 0,
        procedencia: "presencial",
      })
    ).rejects.toThrow("Stock insuficiente");
  });

  // GR-I-07: error HTML (500 sin JSON) lanza mensaje legible en lugar de crash de parseo
  it("GR-I-07: respuesta HTML de error produce mensaje legible, no 'Unexpected token <'", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => "text/html" },
      json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
    });

    await expect(
      createVenta({
        items: [{ producto_id: PRODUCTO_ID, cantidad: 0.5, precio_unitario: 10000, subtotal: 5000, es_granel: true }],
        metodoPago: "efectivo",
        descuentoPct: 0,
        procedencia: "presencial",
      })
    ).rejects.toThrow("Error 500: respuesta inesperada del servidor");
  });
});
