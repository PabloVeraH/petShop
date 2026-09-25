/**
 * Tests I-572 a I-585: POST /api/productos/[id]/saco — acciones sobre el saco
 * abierto de un producto granel (Fase 1b de
 * docs/canales-stock/stock_canales_externos.md, §4.6, D18/D19, G2/G6).
 *
 * admin-check es el REAL (requireStoreAdmin): solo se simula la sesión Clerk.
 * Las RPC (abrir_saco, cerrar_saco_merma, deshacer_apertura_saco, migración
 * 077) se simulan: su semántica en BD (gramos, stock derivado, bloqueo,
 * tenant) se verifica con docs/canales-stock/stock_canales_fase1b_verificacion.sql
 * — un mock no prueba la BD.
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const OTRA_STORE = "123e4567-e89b-12d3-a456-4266141740ff";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174010";
const SACO_ID = "123e4567-e89b-12d3-a456-426614174030";

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

import { POST } from "@/app/api/productos/[id]/saco/route";

const SESION_ADMIN = { sessionClaims: { sub: "admin-1", publicMetadata: { storeId: STORE_ID, storeAdmin: true } } };
const SESION_WORKER = { sessionClaims: { sub: "worker-1", publicMetadata: { storeId: STORE_ID } } };

const SACO = {
  id: SACO_ID, store_id: STORE_ID, producto_id: PRODUCTO_ID, lote_id: null, origen: "apertura",
  gramos_iniciales: 15000, gramos_restantes: 15000, abierto_at: "2026-09-24T10:00:00Z",
  abierto_por: "worker-1", cerrado_at: null, cerrado_por: null, motivo_cierre: null, gramos_merma: null, nota: null,
};

async function post(body: unknown, id = PRODUCTO_ID) {
  const request = new NextRequest(`http://localhost/api/productos/${id}/saco`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetStoreId.mockResolvedValue({ userId: "worker-1", storeId: STORE_ID });
  mockAuth.mockResolvedValue(SESION_WORKER);
  mockRpc.mockResolvedValue({ data: { saco: SACO, stock: 10 }, error: null });
  mockLogAudit.mockResolvedValue(undefined);
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.single = jest.fn().mockResolvedValue({
    data: { id: PRODUCTO_ID, nombre: "Alimento granel", marca: null, precio: 60000, stock: 9, activo: true },
    error: null,
  });
  mockFrom.mockReturnValue(chain);
});

describe("POST /api/productos/[id]/saco", () => {
  // I-572 — D18: cualquier usuario de la tienda abre un saco (lo usa el POS).
  it("I-572: storeWorker abre un saco → 200, RPC con tenant y usuario de la sesión, auditoría", async () => {
    const res = await post({ accion: "abrir", nota: "saco nuevo" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saco: SACO, stock: 10 });
    expect(mockRpc).toHaveBeenCalledWith("abrir_saco", {
      p_store_id: STORE_ID,
      p_producto_id: PRODUCTO_ID,
      p_user_id: "worker-1",
      p_nota: "saco nuevo",
    });
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "saco_abierto",
      entityId: SACO_ID,
      result: "success",
      changeDescription: expect.stringContaining("Apertura de saco (15000 g)"),
    }));
    // Abrir no cambia el stock total → no hay sync con el Hub.
    expect(mockSync).not.toHaveBeenCalled();
  });

  // I-573 — G6: merma con motivo; guarda el usuario (p_user_id) y sincroniza
  // el stock (la merma sí lo baja).
  it("I-573: merma con motivo → 200, RPC cerrar_saco_merma con usuario, auditoría y sync", async () => {
    mockRpc.mockResolvedValue({
      data: { saco: { ...SACO, gramos_restantes: 0, motivo_cierre: "merma", cerrado_por: "worker-1", gramos_merma: 700 }, stock: 9, gramos_merma: 700 },
      error: null,
    });
    const res = await post({ accion: "merma", motivo: "Saco húmedo" });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("cerrar_saco_merma", {
      p_store_id: STORE_ID,
      p_producto_id: PRODUCTO_ID,
      p_motivo: "Saco húmedo",
      p_user_id: "worker-1",
    });
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      changeDescription: expect.stringContaining("700 g"),
    }));
    expect(mockSync).toHaveBeenCalledWith([expect.objectContaining({ producto_id: PRODUCTO_ID, stock: 9 })]);
  });

  // I-574 — G2: deshacer apertura con storeAdmin → 200.
  it("I-574: storeAdmin deshace la apertura → 200, RPC deshacer_apertura_saco", async () => {
    mockAuth.mockResolvedValue(SESION_ADMIN);
    mockGetStoreId.mockResolvedValue({ userId: "admin-1", storeId: STORE_ID });
    mockRpc.mockResolvedValue({ data: { saco: { ...SACO, motivo_cierre: "deshecho" }, stock: 10 }, error: null });
    const res = await post({ accion: "deshacer" });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("deshacer_apertura_saco", {
      p_store_id: STORE_ID,
      p_producto_id: PRODUCTO_ID,
      p_user_id: "admin-1",
    });
  });

  // I-575 — G2: storeWorker no puede deshacer (403 sin tocar la BD).
  it("I-575: storeWorker intenta deshacer → 403, RPC no llamado", async () => {
    const res = await post({ accion: "deshacer" });
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-576: storeAdmin de otra tienda intenta deshacer → 403", async () => {
    mockAuth.mockResolvedValue({ sessionClaims: { sub: "a9", publicMetadata: { storeId: OTRA_STORE, storeAdmin: true } } });
    const res = await post({ accion: "deshacer" });
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-577: sin sesión → 401", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const res = await post({ accion: "abrir" });
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // I-578 — IDOR: producto de otra tienda → la RPC (filtra por store_id) no
  // lo encuentra → 404 genérico, sin repetir el UUID.
  it("I-578: producto de otra tienda → 404 genérico", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: `Producto no encontrado: ${PRODUCTO_ID}` } });
    const res = await post({ accion: "abrir" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Producto no encontrado" });
  });

  // I-579 — §6.2: store_id / user_id en el body se ignoran.
  it("I-579: store_id y user_id maliciosos en el body se ignoran", async () => {
    await post({ accion: "abrir", store_id: OTRA_STORE, user_id: "otro" });
    expect(mockRpc).toHaveBeenCalledWith("abrir_saco", expect.objectContaining({
      p_store_id: STORE_ID,
      p_user_id: "worker-1",
    }));
  });

  it.each([
    ["acción desconocida", { accion: "vaciar" }],
    ["sin acción", {}],
    ["merma sin motivo", { accion: "merma" }],
    ["merma con motivo corto", { accion: "merma", motivo: " abc " }],
    ["body no objeto", "abrir"],
  ])("I-580: %s → 400 sin llamar a la BD", async (_desc, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("I-581: id no UUID → 404 sin llamar a la BD", async () => {
    const res = await post({ accion: "abrir" }, "no-es-uuid");
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // I-582 — G6: abrir con gramos en el saco abierto → la BD exige la merma
  // antes → 409 con el mensaje (el POS lo muestra).
  it("I-582: abrir con saco abierto con gramos → 409 con mensaje", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Saco abierto con gramos restantes (700 g): registre la merma del resto antes de abrir otro" },
    });
    const res = await post({ accion: "abrir" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/registre la merma/);
  });

  // I-583 — G2: saco con ventas no se deshace → 409.
  it("I-583: deshacer un saco con ventas → 409", async () => {
    mockAuth.mockResolvedValue(SESION_ADMIN);
    mockRpc.mockResolvedValue({ data: null, error: { message: "El saco no se puede deshacer: tiene ventas asociadas" } });
    const res = await post({ accion: "deshacer" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/ventas asociadas/);
  });

  it("I-584: merma sin saco abierto → 409; producto no granel → 400", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "No hay saco abierto para este producto" } });
    expect((await post({ accion: "merma", motivo: "Saco húmedo" })).status).toBe(409);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "Producto no habilitado para granel (requiere precio por kg y peso del saco)" } });
    expect((await post({ accion: "abrir" })).status).toBe(400);
  });

  // I-585 — error inesperado → 500 genérico + auditoría de fallo, sin filtrar el mensaje.
  it("I-585: error inesperado del RPC → 500 genérico + auditoría de fallo", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "deadlock detected" } });
    const res = await post({ accion: "abrir" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error interno del servidor" });
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ result: "failure", errorMessage: "deadlock detected" }));
  });
});
