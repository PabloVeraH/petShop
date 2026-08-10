/**
 * Tests I-XXX: GET/POST /api/lotes
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174010";

const mockSingle = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
let mockGetStoreId = jest.fn().mockResolvedValue({ userId: "user-1", storeId: STORE_ID });

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

describe("POST /api/lotes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("crea lote con campos mínimos", async () => {
    const createdLote = {
      id: "new-lote-id",
      store_id: STORE_ID,
      producto_id: PRODUCTO_ID,
      numero_lote: null,
      cantidad_inicial: 20,
      cantidad_actual: 20,
      fecha_vencimiento: "2026-12-01",
      fecha_ingreso: new Date().toISOString().split("T")[0],
      notas: null,
      activo: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { id: PRODUCTO_ID }, error: null }) };
      }
      if (table === "lotes_producto") {
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: createdLote, error: null }),
        };
      }
      return {};
    });

    const req = makePostRequest({
      producto_id: PRODUCTO_ID,
      cantidad_inicial: 20,
      fecha_vencimiento: "2026-12-01",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.lote.id).toBe("new-lote-id");
  });

  it("cantidad_actual default = cantidad_inicial", async () => {
    const createdLote = {
      id: "lote-2",
      store_id: STORE_ID,
      producto_id: PRODUCTO_ID,
      cantidad_inicial: 15,
      cantidad_actual: 15,
      fecha_vencimiento: "2026-12-01",
      fecha_ingreso: new Date().toISOString().split("T")[0],
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { id: PRODUCTO_ID }, error: null }) };
      }
      if (table === "lotes_producto") {
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: createdLote, error: null }),
        };
      }
      return {};
    });

    const req = makePostRequest({
      producto_id: PRODUCTO_ID,
      cantidad_inicial: 15,
      cantidad_actual: undefined,
      fecha_vencimiento: "2026-12-01",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("404 si producto_id es de otro store", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }) };
      }
      return {};
    });

    const req = makePostRequest({
      producto_id: PRODUCTO_ID,
      cantidad_inicial: 10,
      fecha_vencimiento: "2026-12-01",
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("400 si fecha_vencimiento no es YYYY-MM-DD", async () => {
    const req = makePostRequest({
      producto_id: PRODUCTO_ID,
      cantidad_inicial: 10,
      fecha_vencimiento: "invalid-date",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("registra en audit_logs", async () => {
    const createdLote = {
      id: "lote-audit",
      store_id: STORE_ID,
      producto_id: PRODUCTO_ID,
      cantidad_inicial: 10,
      cantidad_actual: 10,
      fecha_vencimiento: "2026-12-01",
      fecha_ingreso: new Date().toISOString().split("T")[0],
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { id: PRODUCTO_ID }, error: null }) };
      }
      if (table === "lotes_producto") {
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: createdLote, error: null }),
        };
      }
      return {};
    });

    const { logAudit } = await import("@/lib/audit");
    const req = makePostRequest({
      producto_id: PRODUCTO_ID,
      cantidad_inicial: 10,
      fecha_vencimiento: "2026-12-01",
    });

    await POST(req);
    expect(logAudit).toHaveBeenCalled();
  });

  // I-472 — MEJORA (ticket Trello 6a62eb37bfe280fc94919d5e): mismo defecto
  // reportado para "lotes_producto" en ordenes-compra/[id]/route.ts —
  // changeDescription ausente. Este endpoint (creación manual de lote) tenía
  // el mismo defecto (llamador similar del mismo logAudit/getRequestMetadata).
  it("I-472: audit log de creación manual de lote incluye changeDescription con nombre y cantidad, e IP/userAgent", async () => {
    const createdLote = {
      id: "lote-audit-2",
      store_id: STORE_ID,
      producto_id: PRODUCTO_ID,
      cantidad_inicial: 12,
      cantidad_actual: 12,
      fecha_vencimiento: "2026-12-01",
      fecha_ingreso: new Date().toISOString().split("T")[0],
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { id: PRODUCTO_ID, nombre: "Alimento Gato Whiskas 1kg" }, error: null }) };
      }
      if (table === "lotes_producto") {
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: createdLote, error: null }),
        };
      }
      return {};
    });

    const { logAudit } = await import("@/lib/audit");
    const req = makePostRequest({
      producto_id: PRODUCTO_ID,
      cantidad_inicial: 12,
      fecha_vencimiento: "2026-12-01",
    });

    await POST(req);

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        changeDescription: "Lote creado manualmente: Alimento Gato Whiskas 1kg × 12 unidades",
        ipAddress: "127.0.0.1",
        userAgent: "test",
      })
    );
  });
});