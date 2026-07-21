/**
 * Tests I-50 a I-56, I-431, I-436: PATCH /api/inventario/[id]
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174010";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();
const mockSingle = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("@/lib/hub-sync", () => ({ syncProductsToHub: jest.fn() }));

import { PATCH } from "@/app/api/inventario/[id]/route";
import { syncProductsToHub } from "@/lib/hub-sync";

function chain() {
  const c: Record<string, jest.Mock> = {};
  c.select = jest.fn().mockReturnValue(c);
  c.update = jest.fn().mockReturnValue(c);
  c.insert = jest.fn().mockReturnValue(c);
  c.eq = jest.fn().mockReturnValue(c);
  c.single = mockSingle;
  return c;
}

function makeRequest(body: object) {
  return new NextRequest(`http://localhost/api/inventario/${PRODUCTO_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: PRODUCTO_ID });

describe("PATCH /api/inventario/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockFrom.mockReturnValue(chain());
  });

  // I-50
  it("I-50: tipo inválido → 400", async () => {
    const res = await PATCH(makeRequest({ tipo: "regalo", cantidad: 5 }), { params });
    expect(res.status).toBe(400);
  });

  // I-51
  it("I-51: cantidad no entero positivo → 400", async () => {
    const res = await PATCH(makeRequest({ tipo: "entrada", cantidad: -3 }), { params });
    expect(res.status).toBe(400);
  });

  it("I-51b: cantidad decimal → 400", async () => {
    const res = await PATCH(makeRequest({ tipo: "entrada", cantidad: 1.5 }), { params });
    expect(res.status).toBe(400);
  });

  // I-52
  it("I-52: producto de otro store → 404", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const res = await PATCH(makeRequest({ tipo: "entrada", cantidad: 5 }), { params });
    expect(res.status).toBe(404);
  });

  // I-53
  it("I-53: entrada suma stock correctamente", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, stock: 10 }, error: null })
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, nombre: "Alimento", marca: null, precio: 10000, stock: 15 }, error: null });

    const res = await PATCH(makeRequest({ tipo: "entrada", cantidad: 5 }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stock).toBe(15);
  });

  // I-54 — REGRESIÓN (ticket Trello 6a5f9a8c29a2a067617111f7): antes el endpoint
  // NO validaba salida > stock: clampeaba el stock a 0 (Math.max) pero registraba
  // el movimiento con la cantidad completa (-50), dejando historial y stock real
  // inconsistentes. El contrato nuevo es rechazar con 422 sin tocar la BD.
  // NOTA: este test reemplaza la expectativa anterior de I-54 ("salida no baja
  // el stock por debajo de 0 (Math.max)"), que codificaba exactamente el
  // comportamiento bugueado reportado — ver AGENTS.md §3.
  it("I-54: salida con cantidad mayor al stock → 422, sin UPDATE ni movimiento", async () => {
    const updateMock = jest.fn();
    const insertMock = jest.fn();
    // single LOCAL (no el compartido mockSingle): con el fix solo se consume el
    // primer valor; el segundo existe solo para que, contra el código bugueado,
    // la aserción de status falle limpiamente (200) en vez de lanzar TypeError.
    // Un valor sobrante en mockSingle se filtraría al siguiente test (jest
    // clearAllMocks no limpia la cola de mockResolvedValueOnce).
    const localSingle = jest.fn()
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, stock: 4 }, error: null })
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, nombre: "X", marca: null, precio: 1000, stock: 0 }, error: null });
    mockFrom.mockImplementation(() => {
      const c = chain();
      c.single = localSingle;
      c.update = updateMock.mockReturnValue(c);
      c.insert = insertMock.mockReturnValue(c);
      return c;
    });

    const res = await PATCH(makeRequest({ tipo: "salida", cantidad: 50 }), { params });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("Stock insuficiente");
    expect(body.error).toContain("4");
    expect(body.error).toContain("50");
    // La operación rechazada no debe modificar stock ni registrar movimiento
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  // I-436 — frontera: salida con cantidad EXACTAMENTE igual al stock se permite
  // (no sobre-bloquear), deja el stock en 0 y registra el movimiento completo.
  it("I-436: salida con cantidad igual al stock → 200, stock queda en 0 y movimiento registra la salida completa", async () => {
    let stockPasado: number | undefined;
    const inserts: Record<string, unknown>[] = [];
    mockFrom.mockImplementation((table: string) => {
      const c = chain();
      c.update = jest.fn().mockImplementation((data: { stock: number }) => {
        stockPasado = data.stock;
        return c;
      });
      if (table === "stock_movements") {
        c.insert = jest.fn((data: Record<string, unknown>) => {
          inserts.push(data);
          return c;
        });
      }
      return c;
    });
    mockSingle
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, stock: 4 }, error: null })
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, nombre: "X", marca: null, precio: 1000, stock: 0 }, error: null });

    const res = await PATCH(makeRequest({ tipo: "salida", cantidad: 4 }), { params });

    expect(res.status).toBe(200);
    expect(stockPasado).toBe(0);
    // stock y movimiento quedan consistentes: -4 registrado sobre stock 4 → 0
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ producto_id: PRODUCTO_ID, tipo: "salida", cantidad: -4 });
  });

  // I-55
  it("I-55: ajuste crea registro en stock_movements con user_id", async () => {
    const inserts: { table: string; data: Record<string, unknown> }[] = [];
    const c = chain();
    c.insert = jest.fn((data: Record<string, unknown>) => {
      inserts.push({ table: "stock_movements", data });
      return c;
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "stock_movements") return c;
      return chain();
    });
    mockSingle
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, stock: 5 }, error: null })
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, nombre: "X", marca: null, precio: 1000, stock: 10 }, error: null });

    await PATCH(makeRequest({ tipo: "entrada", cantidad: 5 }), { params });
    const movInsert = inserts.find((i) => i.table === "stock_movements");
    expect(movInsert).toBeDefined();
    expect(movInsert!.data).toMatchObject({
      producto_id: PRODUCTO_ID,
      tipo: "entrada",
      cantidad: 5,
      user_id: "u1",
    });
  });

  // I-56
  it("I-56: ajuste llama syncProductsToHub con stock actualizado", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, stock: 5 }, error: null })
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, nombre: "Alimento Test", marca: "Royal", precio: 12000, stock: 10 }, error: null });

    await PATCH(makeRequest({ tipo: "entrada", cantidad: 5 }), { params });
    expect(syncProductsToHub).toHaveBeenCalledWith([
      expect.objectContaining({ producto_id: PRODUCTO_ID, stock: 10 }),
    ]);
  });

  // I-431
  it("I-431: error en update del producto retorna 500", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, stock: 5 }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "error de DB simulado", code: "PGRST000" } });

    const res = await PATCH(makeRequest({ tipo: "entrada", cantidad: 5 }), { params });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Error interno del servidor" });
  });
});
