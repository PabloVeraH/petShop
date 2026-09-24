/**
 * Tests I-XXX, I-472, I-537..I-543: GET/POST /api/lotes
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174010";

const mockSingle = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockAuth = jest.fn();
let mockGetStoreId = jest.fn().mockResolvedValue({ userId: "user-1", storeId: STORE_ID });

// admin-check es el REAL (requireStoreAdmin): solo se simula la sesión Clerk.
jest.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));

const mockChain = {
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  gt: jest.fn().mockReturnThis(),
};
mockFrom.mockReturnValue(mockChain);

jest.mock("@/lib/auth", () => ({
  getStoreId: () => mockGetStoreId(),
}));

jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));

jest.mock("@/lib/audit", () => ({
  withErrorLogging: (handler) => handler,
  logAudit: jest.fn().mockResolvedValue(undefined),
  // getRequestMetadata NO es async en la implementación real (src/lib/audit.ts:
  // `export function getRequestMetadata(req) { return {...} }`) — mockReturnValue,
  // no mockResolvedValue. Con mockResolvedValue, un caller que ya no hace
  // `await getRequestMetadata(...)` (patrón correcto en el resto del código)
  // desestructura un Promise en vez del objeto, y ipAddress/userAgent quedan
  // undefined en logAudit sin que ningún test lo note si no se afirma el valor.
  getRequestMetadata: jest.fn().mockReturnValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

import { GET, POST } from "@/app/api/lotes/route";

function makeGetRequest(url: string) {
  return new NextRequest(`http://localhost${url}`);
}

function makePostRequest(body: object) {
  return new NextRequest("http://localhost/api/lotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/lotes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSingle.mockResolvedValue({ data: [], error: null });
    mockChain.select.mockReturnThis();
    mockChain.eq.mockReturnThis();
    mockChain.order.mockReturnThis();
    mockChain.gt.mockReturnThis();
    mockFrom.mockReturnValue(mockChain);
  });

  it("retorna 401 sin auth", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const req = makeGetRequest("/api/lotes");
    const res = await GET(req);
    expect(res.status).toBe(401);
    mockGetStoreId.mockResolvedValue({ userId: "user-1", storeId: STORE_ID });
  });

  it("devuelve lotes del store del usuario", async () => {
    const lotesData = [
      {
        id: "lote-1", store_id: STORE_ID, producto_id: PRODUCTO_ID,
        numero_lote: "L001", cantidad_inicial: 50, cantidad_actual: 30,
        fecha_vencimiento: "2026-12-01", fecha_ingreso: "2026-05-01",
        activo: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        producto: { id: PRODUCTO_ID, nombre: "Alimento", sku: "SKU1", stock: 30, dias_alerta_expira: 30 },
      },
    ];
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: lotesData, error: null }),
    });

    const req = makeGetRequest("/api/lotes");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lotes).toHaveLength(1);
    expect(body.lotes[0].numero_lote).toBe("L001");
  });

  it("filtra por producto_id", async () => {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    });

    const req = makeGetRequest(`/api/lotes?producto_id=${PRODUCTO_ID}`);
    await GET(req);
    expect(mockFrom).toHaveBeenCalledWith("lotes_producto");
  });

  it("filtra con ?con_stock=1", async () => {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gt: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    });

    const req = makeGetRequest("/api/lotes?con_stock=1");
    await GET(req);
  });

  it("ordena por fecha_vencimiento ASC", async () => {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    });

    const req = makeGetRequest("/api/lotes");
    await GET(req);
  });
});

// POST /api/lotes — Fase 1 (docs/canales-stock/stock_canales_externos.md, migración 076):
// el alta pasa por la RPC registrar_lote (D11: convierte el stock suelto en
// "LOTE-0" en la misma transacción — S6) y exige storeAdmin/systemAdmin en el
// servidor (S11). Los contratos previos (201, cantidad_actual por defecto,
// 404 otra tienda, 400 fecha inválida, auditoría I-472) se conservan; solo
// cambia el mecanismo de escritura (RPC en vez de INSERT directo).
describe("POST /api/lotes", () => {
  const LOTE_CREADO = {
    id: "new-lote-id",
    store_id: STORE_ID,
    producto_id: PRODUCTO_ID,
    numero_lote: null,
    cantidad_inicial: 20,
    cantidad_actual: 20,
    fecha_vencimiento: "2026-12-01",
    fecha_ingreso: "2026-09-24",
    notas: null,
    activo: true,
  };

  function mockProducto(data: object | null) {
    const insertLotes = jest.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue(data ? { data, error: null } : { data: null, error: { code: "PGRST116" } }),
        };
      }
      if (table === "lotes_producto") return { insert: insertLotes };
      return {};
    });
    return { insertLotes };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId = jest.fn().mockResolvedValue({ userId: "user-1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({ sessionClaims: { sub: "user-1", publicMetadata: { storeId: STORE_ID, storeAdmin: true } } });
    mockRpc.mockResolvedValue({ data: { lote: LOTE_CREADO, lote_inicial: null }, error: null });
  });

  it("crea lote con campos mínimos", async () => {
    const { insertLotes } = mockProducto({ id: PRODUCTO_ID, nombre: "Alimento" });

    const res = await POST(makePostRequest({ producto_id: PRODUCTO_ID, cantidad_inicial: 20, fecha_vencimiento: "2026-12-01" }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.lote.id).toBe("new-lote-id");
    expect(mockRpc).toHaveBeenCalledWith("registrar_lote", expect.objectContaining({
      p_store_id: STORE_ID,
      p_producto_id: PRODUCTO_ID,
      p_cantidad_inicial: 20,
      p_fecha_vencimiento: "2026-12-01",
      p_user_id: "user-1",
    }));
    // S6: nunca un INSERT directo en lotes_producto (el trigger borraría el
    // stock suelto); toda alta pasa por la RPC atómica.
    expect(insertLotes).not.toHaveBeenCalled();
  });

  it("cantidad_actual default = cantidad_inicial", async () => {
    mockProducto({ id: PRODUCTO_ID, nombre: "Alimento" });

    const res = await POST(makePostRequest({ producto_id: PRODUCTO_ID, cantidad_inicial: 15, fecha_vencimiento: "2026-12-01" }));

    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith("registrar_lote", expect.objectContaining({
      p_cantidad_inicial: 15,
      p_cantidad_actual: 15,
    }));
  });

  it("404 si producto_id es de otro store", async () => {
    mockProducto(null);

    const res = await POST(makePostRequest({ producto_id: PRODUCTO_ID, cantidad_inicial: 10, fecha_vencimiento: "2026-12-01" }));

    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("400 si fecha_vencimiento no es YYYY-MM-DD", async () => {
    mockProducto({ id: PRODUCTO_ID, nombre: "Alimento" });
    const res = await POST(makePostRequest({ producto_id: PRODUCTO_ID, cantidad_inicial: 10, fecha_vencimiento: "invalid-date" }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("registra en audit_logs", async () => {
    mockProducto({ id: PRODUCTO_ID, nombre: "Alimento" });
    const { logAudit } = await import("@/lib/audit");

    await POST(makePostRequest({ producto_id: PRODUCTO_ID, cantidad_inicial: 10, fecha_vencimiento: "2026-12-01" }));

    expect(logAudit).toHaveBeenCalled();
  });

  // I-472 — MEJORA (ticket Trello 6a62eb37bfe280fc94919d5e): mismo defecto
  // reportado para "lotes_producto" en ordenes-compra/[id]/route.ts —
  // changeDescription ausente. Este endpoint (creación manual de lote) tenía
  // el mismo defecto (llamador similar del mismo logAudit/getRequestMetadata).
  it("I-472: audit log de creación manual de lote incluye changeDescription con nombre y cantidad, e IP/userAgent", async () => {
    mockProducto({ id: PRODUCTO_ID, nombre: "Alimento Gato Whiskas 1kg" });
    mockRpc.mockResolvedValue({ data: { lote: { ...LOTE_CREADO, id: "lote-audit-2", cantidad_inicial: 12, cantidad_actual: 12 }, lote_inicial: null }, error: null });
    const { logAudit } = await import("@/lib/audit");

    await POST(makePostRequest({ producto_id: PRODUCTO_ID, cantidad_inicial: 12, fecha_vencimiento: "2026-12-01" }));

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        changeDescription: "Lote creado manualmente: Alimento Gato Whiskas 1kg × 12 unidades",
        ipAddress: "127.0.0.1",
        userAgent: "test",
      })
    );
  });

  // I-537 — S11: sin sesión → 401.
  it("I-537: sin sesión → 401", async () => {
    mockGetStoreId = jest.fn().mockResolvedValue(null);
    const res = await POST(makePostRequest({ producto_id: PRODUCTO_ID, cantidad_inicial: 10, fecha_vencimiento: "2026-12-01" }));
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // I-538 — S11: storeWorker → 403 (antes el endpoint no validaba rol).
  it("I-538: storeWorker → 403 sin llamar a la BD", async () => {
    mockAuth.mockResolvedValue({ sessionClaims: { sub: "w1", publicMetadata: { storeId: STORE_ID } } });
    const res = await POST(makePostRequest({ producto_id: PRODUCTO_ID, cantidad_inicial: 10, fecha_vencimiento: "2026-12-01" }));
    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // I-539 — D11/D21: la fecha de vencimiento del stock existente viaja a la
  // RPC y, si hubo conversión a LOTE-0, se audita por separado y se devuelve.
  it("I-539: primer lote con stock suelto → envía fecha del stock existente y audita el LOTE-0", async () => {
    mockProducto({ id: PRODUCTO_ID, nombre: "Alimento" });
    const loteInicial = { ...LOTE_CREADO, id: "lote-0", numero_lote: "LOTE-0", cantidad_inicial: 100, cantidad_actual: 100 };
    mockRpc.mockResolvedValue({ data: { lote: { ...LOTE_CREADO, cantidad_inicial: 50, cantidad_actual: 50 }, lote_inicial: loteInicial }, error: null });
    const { logAudit } = await import("@/lib/audit");

    const res = await POST(makePostRequest({
      producto_id: PRODUCTO_ID,
      cantidad_inicial: 50,
      fecha_vencimiento: "2027-01-01",
      fecha_vencimiento_stock_existente: "2026-11-15",
    }));

    expect(res.status).toBe(201);
    expect((await res.json()).lote_inicial.id).toBe("lote-0");
    expect(mockRpc).toHaveBeenCalledWith("registrar_lote", expect.objectContaining({
      p_fecha_venc_stock_existente: "2026-11-15",
    }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityId: "lote-0",
      changeDescription: "Stock existente convertido a lote inicial: Alimento × 100 unidades",
    }));
  });

  // I-540 — §6.2: store_id malicioso en el body se ignora; la RPC recibe el
  // tenant de la sesión.
  it("I-540: store_id en el body se ignora (se usa el de la sesión)", async () => {
    mockProducto({ id: PRODUCTO_ID, nombre: "Alimento" });
    await POST(makePostRequest({
      producto_id: PRODUCTO_ID,
      cantidad_inicial: 10,
      fecha_vencimiento: "2026-12-01",
      store_id: "123e4567-e89b-12d3-a456-4266141740ff",
    }));
    expect(mockRpc).toHaveBeenCalledWith("registrar_lote", expect.objectContaining({ p_store_id: STORE_ID }));
  });

  // I-541 — D21: sin vencimiento para el stock existente (ni en el producto)
  // la BD rechaza → 422 con el mensaje, no 500.
  it("I-541: falta el vencimiento del stock existente → 422 con el mensaje de la BD", async () => {
    mockProducto({ id: PRODUCTO_ID, nombre: "Alimento" });
    mockRpc.mockResolvedValue({ data: null, error: { message: "Falta la fecha de vencimiento del stock existente (100 unidades)" } });

    const res = await POST(makePostRequest({ producto_id: PRODUCTO_ID, cantidad_inicial: 10, fecha_vencimiento: "2026-12-01" }));

    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("100 unidades");
  });

  // I-542 — cantidad_actual mayor que la inicial → 400 (antes llegaba a la BD).
  it("I-542: cantidad_actual > cantidad_inicial → 400", async () => {
    mockProducto({ id: PRODUCTO_ID, nombre: "Alimento" });
    const res = await POST(makePostRequest({ producto_id: PRODUCTO_ID, cantidad_inicial: 10, cantidad_actual: 11, fecha_vencimiento: "2026-12-01" }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // I-543 — error no reconocido de la BD → 500 genérico (no se filtra el
  // mensaje interno, a diferencia del `error.message` que devolvía antes).
  it("I-543: error genérico de la RPC → 500 sin filtrar el mensaje interno", async () => {
    mockProducto({ id: PRODUCTO_ID, nombre: "Alimento" });
    mockRpc.mockResolvedValue({ data: null, error: { message: "connection reset by peer" } });
    const res = await POST(makePostRequest({ producto_id: PRODUCTO_ID, cantidad_inicial: 10, fecha_vencimiento: "2026-12-01" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Error interno del servidor");
  });
});
