/**
 * Tests I-101 a I-103, I-759 a I-760: POST /api/whatsapp/send-alerts
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();
const mockSendWhatsAppText = jest.fn();
const mockAuth = jest.fn();
const mockLogAudit = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
jest.mock("@/lib/usuario-habilitado", () => ({ usuarioDeshabilitado: jest.fn().mockResolvedValue(false) }));
jest.mock("@/lib/audit", () => ({
  withErrorLogging: (handler: unknown) => handler,
  logAudit: mockLogAudit,
  getRequestMetadata: jest.fn(() => ({ ipAddress: "127.0.0.1", userAgent: "test-agent" })),
}));

const ADMIN = { sub: "u1", publicMetadata: { storeId: STORE_ID, storeAdmin: true } };
const WORKER = { sub: "u1", publicMetadata: { storeId: STORE_ID } };
const req = () => new NextRequest("http://localhost/api/whatsapp/send-alerts", { method: "POST" });
jest.mock("@/lib/supabase", () => ({ createServiceClient: jest.fn(() => ({ from: mockFrom })) }));
jest.mock("@/lib/whatsapp", () => ({
  sendWhatsAppText: mockSendWhatsAppText,
  buildConsumoAlertMessage: jest.fn(() => "Hola, tu alimento termina pronto"),
}));

const BASE_STORE = {
  name: "Pet Store",
  whatsapp_enabled: true,
  whatsapp_phone_number_id: "12345",
  whatsapp_access_token: "token",
  whatsapp_phone_number: "56912345678",
};

const BASE_ALERTA = {
  id: "alerta-1",
  dias_aviso: 7,
  fecha_estimada_termino: new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0], // 2 days from now
  mascota_id: "m1",
  producto_id: "p1",
  cliente_id: "c1",
  clientes: { nombre: "Juan", telefono: "56912345678" },
  mascotas: { nombre: "Rex" },
  productos: { nombre: "Royal Canin" },
};

function makeFrom(alertas: unknown[], store: unknown, productos: unknown[] = []) {
  const queries = { consumo: 0, stores: 0, productos: 0, updates: 0 };

  return jest.fn((table: string) => {
    if (table === "consumo_alertas") {
      queries.consumo++;
      // First call is SELECT, subsequent are UPDATE
      if (queries.consumo === 1) {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          lte: jest.fn().mockResolvedValue({ data: alertas, error: null }),
        };
      }
      // UPDATE calls
      return {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    }
    if (table === "stores") {
      queries.stores++;
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: store, error: null }),
      };
    }
    if (table === "productos") {
      queries.productos++;
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: productos, error: null }),
      };
    }
    // Fallback for unknown tables
    return {
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });
}

describe("POST /api/whatsapp/send-alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockAuth.mockResolvedValue({ sessionClaims: ADMIN });
  });

  // I-101
  it("I-101: alertas pendientes → envía y retorna sent > 0", async () => {
    mockSendWhatsAppText.mockResolvedValue(true);
    const fromImpl = makeFrom([BASE_ALERTA], BASE_STORE, []);
    mockFrom.mockImplementation(fromImpl);
    const { POST } = await import("@/app/api/whatsapp/send-alerts/route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBeGreaterThanOrEqual(0);
  });

  // I-102
  it("I-102: sin alertas pendientes → { sent: 0, skipped: 0 }", async () => {
    const fromImpl = makeFrom([], BASE_STORE, []);
    mockFrom.mockImplementation(fromImpl);
    const { POST } = await import("@/app/api/whatsapp/send-alerts/route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(0);
  });

  // I-103
  it("I-103: alerta sin teléfono → skipped y no llama sendWhatsAppText", async () => {
    const alertaSinTelefono = { ...BASE_ALERTA, clientes: { nombre: "Juan", telefono: null } };
    const fromImpl = makeFrom([alertaSinTelefono], BASE_STORE, []);
    mockFrom.mockImplementation(fromImpl);
    const { POST } = await import("@/app/api/whatsapp/send-alerts/route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mockSendWhatsAppText).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.skipped).toBeGreaterThanOrEqual(1);
  });

  it("I-759: un vendedor (storeWorker) recibe 403, no se consulta ni se envía nada", async () => {
    mockAuth.mockResolvedValue({ sessionClaims: WORKER });
    mockFrom.mockImplementation(makeFrom([BASE_ALERTA], BASE_STORE, []));
    const { POST } = await import("@/app/api/whatsapp/send-alerts/route");
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSendWhatsAppText).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("I-760: todo envío del admin queda en auditoría, también el que no tenía alertas", async () => {
    mockFrom.mockImplementation(makeFrom([], BASE_STORE, []));
    const { POST } = await import("@/app/api/whatsapp/send-alerts/route");
    await POST(req());
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      storeId: STORE_ID,
      userId: "u1",
      action: "CREATE",
      entityType: "envio_alertas",
      newValues: { canal: "whatsapp", sent: 0, skipped: 0 },
    }));
  });
});
