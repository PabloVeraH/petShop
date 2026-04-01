/**
 * Tests I-50 a I-56: PATCH /api/inventario/[id]
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

  // I-54
  it("I-54: salida no baja el stock por debajo de 0 (Math.max)", async () => {
    let stockPasado: number | undefined;
    mockFrom.mockImplementation(() => {
      const c = chain();
      c.update = jest.fn().mockImplementation((data: { stock: number }) => {
        stockPasado = data.stock;
        return c;
      });
      return c;
    });
    mockSingle
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, stock: 3 }, error: null })
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, nombre: "X", marca: null, precio: 1000, stock: 0 }, error: null });

    await PATCH(makeRequest({ tipo: "salida", cantidad: 10 }), { params });
    expect(stockPasado).toBe(0); // Math.max(0, 3-10) = 0
  });

  // I-55
  it("I-55: ajuste crea registro en stock_movements", async () => {
    const fromCalls: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      fromCalls.push(table);
      return chain();
    });
    mockSingle
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, stock: 5 }, error: null })
      .mockResolvedValueOnce({ data: { id: PRODUCTO_ID, nombre: "X", marca: null, precio: 1000, stock: 10 }, error: null });

    await PATCH(makeRequest({ tipo: "entrada", cantidad: 5 }), { params });
    expect(fromCalls).toContain("stock_movements");
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
});
