/**
 * Tests I-552 a I-563: POST /api/inventario/[id]/conteo — ajuste por conteo
 * físico (D22, Fase 1 de docs/canales-stock/stock_canales_externos.md, RPC ajustar_stock_conteo
 * de la migración 076).
 *
 * admin-check es el REAL (requireStoreAdmin): solo se simula la sesión Clerk.
 * El RPC se simula: la semántica en BD (fijar lote/stock, movimiento
 * 'ajuste_conteo', tenant) se verifica aparte con el script de verificación
 * real (docs/canales-stock/stock_canales_fase1_verificacion.sql) — un mock no prueba la BD.
 */
import { NextRequest } from "next/server";

jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return { ...actual, after: jest.fn((cb: () => void) => cb()) };
});

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const OTRA_STORE = "123e4567-e89b-12d3-a456-4266141740ff";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174010";
const LOTE_ID = "123e4567-e89b-12d3-a456-426614174020";

const mockGetStoreId = jest.fn();
const mockAuth = jest.fn();
const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockLogAudit = jest.fn();
const mockSync = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: () => mockGetStoreId() }));
jest.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ rpc: mockRpc, from: mockFrom }) }));
jest.mock("@/lib/hub-sync", () => ({ syncProductsToHub: (...a: unknown[]) => mockSync(...a) }));
jest.mock("@/lib/audit", () => ({
  withErrorLogging: (h: unknown) => h,
  logAudit: (...a: unknown[]) => mockLogAudit(...a),
  getRequestMetadata: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

import { POST } from "@/app/api/inventario/[id]/conteo/route";

const SESION_ADMIN = { sessionClaims: { sub: "u1", publicMetadata: { storeId: STORE_ID, storeAdmin: true } } };

function req(body: object, id = PRODUCTO_ID) {
  return {
    request: new NextRequest(`http://localhost/api/inventario/${id}/conteo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

async function post(body: object, id = PRODUCTO_ID) {
  const { request, ctx } = req(body, id);
  return POST(request, ctx);
}

const RESULTADO = {
  stock_anterior: 9.5,
  stock_nuevo: 9,
  cantidad_anterior: 9.5,
  cantidad_contada: 9,
  delta: -0.5,
  lote_id: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  mockAuth.mockResolvedValue(SESION_ADMIN);
  mockRpc.mockResolvedValue({ data: RESULTADO, error: null });
  mockLogAudit.mockResolvedValue(undefined);
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.single = jest.fn().mockResolvedValue({
    data: { id: PRODUCTO_ID, nombre: "Alimento", marca: null, precio: 1000, stock: 9, activo: true },
    error: null,
  });
  mockFrom.mockReturnValue(chain);
});

describe("POST /api/inventario/[id]/conteo", () => {
  // I-552 — camino feliz: corrige el decimal heredado de S9 (9,5 → 9).
  it("I-552: admin fija el stock contado → 200, RPC con tenant de la sesión, auditoría y sync", async () => {
    const res = await post({ stock_contado: 9, motivo: "Conteo de fin de mes" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RESULTADO);
    expect(mockRpc).toHaveBeenCalledWith("ajustar_stock_conteo", {
      p_store_id: STORE_ID,
      p_producto_id: PRODUCTO_ID,
      p_lote_id: null,
      p_stock_contado: 9,
      p_motivo: "Conteo de fin de mes",
      p_user_id: "u1",
      // Migración 077: sin gramos contados → null (la BD no toca el saco abierto).
      p_gramos_saco_abierto: null,
    });
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "UPDATE",
      entityType: "inventario",
      entityId: PRODUCTO_ID,
      oldValues: expect.objectContaining({ stock: 9.5 }),
      newValues: expect.objectContaining({ stock: 9 }),
      result: "success",
    }));
    expect(mockSync).toHaveBeenCalledWith([expect.objectContaining({ producto_id: PRODUCTO_ID, stock: 9 })]);
  });

  // I-553 — producto con lotes: el conteo es por lote (lote_id viaja al RPC).
  it("I-553: conteo por lote → lote_id enviado al RPC", async () => {
    mockRpc.mockResolvedValue({ data: { ...RESULTADO, lote_id: LOTE_ID }, error: null });
    const res = await post({ stock_contado: 12, lote_id: LOTE_ID, motivo: "Conteo lote vencimiento marzo" });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("ajustar_stock_conteo", expect.objectContaining({ p_lote_id: LOTE_ID }));
  });

  it("I-554: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const res = await post({ stock_contado: 9, motivo: "Conteo mensual" });
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // I-555 — D22: solo storeAdmin/systemAdmin. storeWorker → 403 sin tocar BD.
  it("I-555: storeWorker → 403", async () => {
    mockAuth.mockResolvedValue({ sessionClaims: { sub: "w1", publicMetadata: { storeId: STORE_ID } } });
    const res = await post({ stock_contado: 9, motivo: "Conteo mensual" });
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-556: sesión sin publicMetadata → 403 (se trata como no autorizado)", async () => {
    mockAuth.mockResolvedValue({ sessionClaims: { sub: "x" } });
    const res = await post({ stock_contado: 9, motivo: "Conteo mensual" });
    expect(res.status).toBe(403);
  });

  it("I-557: storeAdmin de otra tienda → 403", async () => {
    mockAuth.mockResolvedValue({ sessionClaims: { sub: "u9", publicMetadata: { storeId: OTRA_STORE, storeAdmin: true } } });
    const res = await post({ stock_contado: 9, motivo: "Conteo mensual" });
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // I-558 — IDOR: producto de otra tienda → el RPC (filtra por store_id) no
  // lo encuentra → 404 genérico, sin repetir el UUID ni confirmar existencia.
  it("I-558: producto de otra tienda → 404 genérico", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: `Producto no encontrado: ${PRODUCTO_ID}` } });
    const res = await post({ stock_contado: 9, motivo: "Conteo mensual" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Producto no encontrado" });
  });

  // I-559 — §6.2: store_id en el body se ignora.
  it("I-559: store_id malicioso en el body se ignora", async () => {
    await post({ stock_contado: 9, motivo: "Conteo mensual", store_id: OTRA_STORE });
    expect(mockRpc).toHaveBeenCalledWith("ajustar_stock_conteo", expect.objectContaining({ p_store_id: STORE_ID }));
  });

  it.each([
    ["motivo vacío", { stock_contado: 9, motivo: "" }],
    ["motivo de 4 caracteres (con espacios)", { stock_contado: 9, motivo: "  abcd  " }],
    ["cantidad negativa", { stock_contado: -1, motivo: "Conteo mensual" }],
    ["más de 3 decimales", { stock_contado: 1.0001, motivo: "Conteo mensual" }],
    ["cantidad no numérica", { stock_contado: "9", motivo: "Conteo mensual" }],
    ["lote_id no UUID", { stock_contado: 9, lote_id: "abc", motivo: "Conteo mensual" }],
  ])("I-560: %s → 400 sin llamar al RPC", async (_desc, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // I-561 — producto con lotes sin lote_id → la BD lo exige → 409 con mensaje.
  it("I-561: producto con lotes sin lote_id → 409", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Producto con lotes: el conteo físico se registra por lote" } });
    const res = await post({ stock_contado: 9, motivo: "Conteo mensual" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/por lote/);
  });

  // I-562 — id de la URL no UUID → 404 sin llamar a la BD.
  it("I-562: id no UUID → 404", async () => {
    const res = await post({ stock_contado: 9, motivo: "Conteo mensual" }, "no-es-uuid");
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // I-563 — error inesperado de BD → 500 genérico y auditoría de fallo.
  it("I-563: error inesperado del RPC → 500 genérico + auditoría de fallo", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "deadlock detected" } });
    const res = await post({ stock_contado: 9, motivo: "Conteo mensual" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error interno del servidor" });
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ result: "failure", errorMessage: "deadlock detected" }));
  });

  it("I-563b: acepta 3 decimales (1.005)", async () => {
    const res = await post({ stock_contado: 1.005, motivo: "Conteo mensual" });
    expect(res.status).toBe(200);
  });

  // I-594 — granel (077): los gramos del saco abierto viajan al RPC y quedan
  // en la auditoría (valor anterior y nuevo).
  it("I-594: gramos_saco_abierto viaja al RPC y a la auditoría", async () => {
    mockRpc.mockResolvedValue({
      data: { ...RESULTADO, gramos_anterior: 10000, gramos_contados: 4000 },
      error: null,
    });
    const res = await post({ stock_contado: 3, gramos_saco_abierto: 4000, motivo: "Conteo saco abierto" });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("ajustar_stock_conteo", expect.objectContaining({
      p_stock_contado: 3,
      p_gramos_saco_abierto: 4000,
    }));
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      oldValues: expect.objectContaining({ gramos_saco_abierto: 10000 }),
      newValues: expect.objectContaining({ gramos_saco_abierto: 4000 }),
      changeDescription: expect.stringContaining("saco abierto 10000 → 4000 g"),
    }));
  });

  it.each([
    ["gramos negativos", -1],
    ["gramos con decimales", 10.5],
    ["gramos no numéricos", "500"],
  ])("I-595: %s → 400 sin llamar al RPC", async (_desc, gramos) => {
    const res = await post({ stock_contado: 3, gramos_saco_abierto: gramos, motivo: "Conteo mensual" });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // I-595b — granel en un producto que no es granel: la BD lo rechaza → 400.
  it("I-595b: gramos en un producto no granel → 400 con el mensaje de la BD", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Producto no habilitado para granel (requiere precio por kg y peso del saco)" } });
    const res = await post({ stock_contado: 3, gramos_saco_abierto: 100, motivo: "Conteo mensual" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no habilitado para granel/);
  });
});
