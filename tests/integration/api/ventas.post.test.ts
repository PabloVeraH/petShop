/**
 * Tests I-34 a I-59: POST /api/ventas
 * Las operaciones de BD (venta, items, pagos, stock, fidelización, consumo_alertas)
 * son ahora responsabilidad del stored procedure `crear_venta_tx` (Migration 037).
 * Estos tests verifican: validaciones del route, datos enviados al RPC y side-effects
 * fire-and-forget (WhatsApp, email, hub sync, contabilidad).
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174010";
const CLIENTE_ID = "123e4567-e89b-12d3-a456-426614174020";

// --- mocks ---
const mockSingle = jest.fn();
const mockRpc = jest.fn();
const mockFrom = jest.fn();

const mockChain = {
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  upsert: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  gt: jest.fn().mockReturnThis(),
  single: mockSingle,
};
mockFrom.mockReturnValue(mockChain);

jest.mock("@/lib/auth", () => ({
  getStoreId: jest.fn().mockResolvedValue({ userId: "user-1", storeId: STORE_ID }),
}));

jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));

jest.mock("@/lib/whatsapp", () => ({
  sendWhatsAppText: jest.fn().mockResolvedValue(undefined),
  buildReceiptMessage: jest.fn().mockReturnValue("receipt"),
}));

jest.mock("@/lib/hub-sync", () => ({
  syncPurchaseToHub: jest.fn(),
  syncProductsToHub: jest.fn(),
}));

jest.mock("@/lib/email", () => ({
  sendBoletaEmail: jest.fn().mockResolvedValue(true),
}));

import { POST } from "@/app/api/ventas/route";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { syncPurchaseToHub } from "@/lib/hub-sync";
import { sendBoletaEmail } from "@/lib/email";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/ventas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_ITEM = { producto_id: PRODUCTO_ID, cantidad: 2 };

const DB_PRODUCTO = { id: PRODUCTO_ID, precio: 10000, precio_oferta: null, en_oferta: false };
const DB_PRODUCTO_SYNC = { id: PRODUCTO_ID, nombre: "Test", marca: null, codigo_barra: null, precio: 10000, stock: 48, activo: true };
// Respuesta simulada del RPC crear_venta_tx
const DB_VENTA = {
  id: "123e4567-e89b-12d3-a456-426614174030",
  total: 20000,
  numero_comprobante: "20260525-ABC12345",
  created_at: new Date().toISOString(),
};

function setupHappyPath() {
  let productosCall = 0;
  mockFrom.mockImplementation((table: string) => {
    if (table === "productos") {
      productosCall++;
      if (productosCall === 1) {
        // Price lookup: .select().in().eq()
        return {
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }),
        };
      }
      // Hub sync: .select().eq().in()
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO_SYNC], error: null }),
      };
    }
    if (table === "stores") {
      return {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { name: "PetShop", whatsapp_enabled: false, email_reminder_dias_aviso: 5, fidelizacion_niveles: null },
          error: null,
        }),
      };
    }
    if (table === "clientes") {
      return {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { rut: "11111111-1" }, error: null }),
      };
    }
    return {
      ...mockChain,
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({ data: [], error: null }),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });
}

// ── Validaciones ─────────────────────────────────────────────────────────────

describe("POST /api/ventas — validaciones", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue(mockChain);
  });

  // I-34
  it("I-34: rechaza items vacíos con 400", async () => {
    const res = await POST(makeRequest({ items: [], metodoPago: "efectivo" }));
    expect(res.status).toBe(400);
  });

  // I-35
  it("I-35: rechaza metodoPago inválido con 400", async () => {
    const res = await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "bitcoin" }));
    expect(res.status).toBe(400);
  });

  // I-36
  it("I-36: rechaza descuentoPct fuera de [0,100] con 400", async () => {
    const res = await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", descuentoPct: 150 }));
    expect(res.status).toBe(400);
  });

  // I-37
  it("I-37: rechaza cantidad no entero positivo con 400", async () => {
    const res = await POST(makeRequest({
      items: [{ producto_id: PRODUCTO_ID, cantidad: -1 }],
      metodoPago: "efectivo",
    }));
    expect(res.status).toBe(400);
  });

  // I-38
  it("I-38: rechaza producto de otro store con 400", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        return {
          ...mockChain,
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return mockChain;
    });
    const res = await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo" }));
    expect(res.status).toBe(400);
  });

  // I-46
  it("I-46: venta sin clienteId es válida (clienteId es opcional)", async () => {
    setupHappyPath();
    mockRpc.mockResolvedValue({ data: DB_VENTA, error: null });
    const res = await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo" }));
    expect(res.status).toBe(200);
  });

  // I-51
  it("I-51: rechaza procedencia inválida con 400", async () => {
    const res = await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", procedencia: "twitter" }));
    expect(res.status).toBe(400);
  });
});

// ── Flujo exitoso ─────────────────────────────────────────────────────────────

describe("POST /api/ventas — flujo exitoso", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupHappyPath();
    mockRpc.mockResolvedValue({ data: DB_VENTA, error: null });
  });

  // I-39: precio tomado de DB (no del body)
  it("I-39: precio tomado de DB — el RPC recibe el total calculado con precio de BD", async () => {
    const res = await POST(makeRequest({
      items: [{ ...VALID_ITEM, precio_unitario: 999 }], // precio trampa en body
      metodoPago: "efectivo",
      clienteId: CLIENTE_ID,
    }));
    expect(res.status).toBe(200);
    // El RPC debe recibir 10000 * 2 = 20000, no 999 * 2
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_total: 20000,
    }));
  });

  // I-40: venta invoca el RPC con store_id y cliente_id
  it("I-40: venta exitosa invoca crear_venta_tx con store_id y cliente_id correctos", async () => {
    const res = await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_store_id: STORE_ID,
      p_cliente_id: CLIENTE_ID,
    }));
  });

  // I-41: RPC recibe los items con precio de DB
  it("I-41: crear_venta_tx recibe los items con precio calculado desde BD", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID }));
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_items: expect.arrayContaining([
        expect.objectContaining({ producto_id: PRODUCTO_ID, cantidad: 2, precio_unitario: 10000 }),
      ]),
    }));
  });

  // I-42: fidelización delegada al RPC via p_cliente_id
  it("I-42: venta con cliente pasa p_cliente_id al RPC para actualizar fidelización internamente", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID }));
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_cliente_id: CLIENTE_ID,
    }));
  });

  // I-43
  it("I-43: venta con cliente RUT llama syncPurchaseToHub", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID }));
    expect(syncPurchaseToHub).toHaveBeenCalledWith("11111111-1", expect.any(Number));
  });

  // I-44
  it("I-44: WhatsApp deshabilitado → sendWhatsAppText no llamado", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID }));
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  // I-45
  it("I-45: WhatsApp habilitado + teléfono válido → sendWhatsAppText llamado", async () => {
    let productosCallI45 = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        productosCallI45++;
        if (productosCallI45 === 1) {
          return { select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }) };
        }
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO_SYNC], error: null }) };
      }
      if (table === "clientes") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { rut: "11111111-1", nombre: "Juan", telefono: "56912345678" }, error: null }),
        };
      }
      if (table === "stores") {
        return {
          ...mockChain,
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { name: "Test", whatsapp_enabled: true, whatsapp_phone_number_id: "123", whatsapp_access_token: "tok", email_reminder_dias_aviso: 5, fidelizacion_niveles: null },
            error: null,
          }),
        };
      }
      if (table === "venta_items") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: [{ cantidad: 2, subtotal: 20000, productos: { nombre: "Test" } }], error: null }),
        };
      }
      return {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [], error: null }),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    });
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID }));
    expect(sendWhatsAppText).toHaveBeenCalled();
  });
});

// ── Cálculo de descuento ──────────────────────────────────────────────────────

describe("POST /api/ventas — cálculo de descuento", () => {
  // precio DB = 10000, cantidad = 2 → subtotal = 20000
  function setupDiscountCapture() {
    let productosCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        productosCall++;
        if (productosCall === 1) {
          return { select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }) };
        }
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO_SYNC], error: null }) };
      }
      if (table === "stores") {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false, email_reminder_dias_aviso: 5 }, error: null }) };
      }
      return {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [], error: null }),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setupDiscountCapture();
    mockRpc.mockResolvedValue({ data: DB_VENTA, error: null });
  });

  // I-47
  it("I-47: sin descuentoPct el p_total enviado al RPC es igual al subtotal (20000)", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo" }));
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({ p_total: 20000, p_descuento_pct: 0 }));
  });

  // I-48
  it("I-48: descuentoPct=10 reduce el p_total al 90% del subtotal (18000)", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", descuentoPct: 10 }));
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({ p_total: 18000, p_descuento_pct: 10 }));
  });

  // I-49
  it("I-49: descuentoPct=50 reduce el p_total a la mitad (10000)", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", descuentoPct: 50 }));
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({ p_total: 10000, p_descuento_pct: 50 }));
  });

  // I-50
  it("I-50: descuentoPct=100 resulta en p_total 0", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", descuentoPct: 100 }));
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({ p_total: 0, p_descuento_pct: 100 }));
  });
});

// ── Procedencia ───────────────────────────────────────────────────────────────

describe("POST /api/ventas — procedencia", () => {
  function setupProcedenciaCapture() {
    let productosCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        productosCall++;
        if (productosCall === 1) {
          return { select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }) };
        }
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO_SYNC], error: null }) };
      }
      if (table === "stores") {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false, email_reminder_dias_aviso: 5 }, error: null }) };
      }
      return {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [], error: null }),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setupProcedenciaCapture();
    mockRpc.mockResolvedValue({ data: DB_VENTA, error: null });
  });

  // I-52
  it("I-52: sin procedencia el p_procedencia enviado al RPC es 'presencial' (default)", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo" }));
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({ p_procedencia: "presencial" }));
  });

  // I-53
  it.each([
    "presencial", "instagram", "whatsapp", "facebook", "tiktok", "telefonico",
  ])("I-53: procedencia='%s' se envía correctamente al RPC", async (proc) => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", procedencia: proc }));
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({ p_procedencia: proc }));
  });

  // I-54
  it("I-54: procedencia se incluye junto con metodo_pago y total en el RPC", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", procedencia: "whatsapp" }));
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_metodo_pago: "efectivo",
      p_procedencia: "whatsapp",
      p_total: 20000,
    }));
  });
});

// ── Toggle email boleta ───────────────────────────────────────────────────────

describe("POST /api/ventas — toggle email boleta", () => {
  function setupWithClientEmail() {
    let productosCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        productosCall++;
        if (productosCall === 1) {
          return { select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }) };
        }
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO_SYNC], error: null }) };
      }
      if (table === "clientes") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { rut: "11111111-1", nombre: "Juan Test", email: "juan@test.com" }, error: null }),
        };
      }
      if (table === "stores") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { name: "PetShop", rut: null, resend_from_email: null, whatsapp_enabled: false, email_reminder_dias_aviso: 5 }, error: null }),
        };
      }
      if (table === "venta_items") {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      return {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [], error: null }),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({ data: DB_VENTA, error: null });
  });

  // I-55
  it("I-55: enviarEmail=true con cliente con email → sendBoletaEmail es llamado", async () => {
    setupWithClientEmail();
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID, enviarEmail: true }));
    expect(sendBoletaEmail).toHaveBeenCalled();
  });

  // I-56
  it("I-56: enviarEmail=false → sendBoletaEmail NO es llamado aunque el cliente tenga email", async () => {
    setupWithClientEmail();
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID, enviarEmail: false }));
    expect(sendBoletaEmail).not.toHaveBeenCalled();
  });

  // I-57
  it("I-57: enviarEmail ausente → sendBoletaEmail NO es llamado", async () => {
    setupHappyPath();
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID }));
    expect(sendBoletaEmail).not.toHaveBeenCalled();
  });
});

// ── Precio granel — regresión I-60/I-61 ──────────────────────────────────────
// Bug: es_granel no se propagaba desde el carrito al body del request, causando
// que el backend usara precio de lista ($56.000) en lugar de precio_venta_kg ($10.000/kg)

const DB_PRODUCTO_GRANEL = {
  id: PRODUCTO_ID,
  precio: 56000,          // precio de lista (envase completo)
  precio_oferta: null,
  en_oferta: false,
  precio_venta_kg: 10000, // precio especial por kg
};

const DB_PRODUCTO_GRANEL_SYNC = {
  id: PRODUCTO_ID, nombre: "Alimento granel", marca: null, codigo_barra: null,
  precio: 56000, stock: 10, activo: true,
};

function setupGranel() {
  let productosCall = 0;
  mockFrom.mockImplementation((table: string) => {
    if (table === "productos") {
      productosCall++;
      if (productosCall === 1) {
        return { select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO_GRANEL], error: null }) };
      }
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO_GRANEL_SYNC], error: null }) };
    }
    if (table === "stores") {
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false, email_reminder_dias_aviso: 5, fidelizacion_niveles: null }, error: null }) };
    }
    return { ...mockChain, select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [], error: null }), single: jest.fn().mockResolvedValue({ data: null, error: null }) };
  });
}

describe("POST /api/ventas — precio granel (I-60/I-61)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupGranel();
    mockRpc.mockResolvedValue({ data: DB_VENTA, error: null });
  });

  // I-60: REGRESIÓN — item granel usa precio_venta_kg, no precio de lista
  it("I-60: item es_granel usa precio_venta_kg ($10.000/kg) y no el precio de lista ($56.000)", async () => {
    // Prueba 1 del reporte: 0.8 kg × $10.000 = $8.000 (correcto)
    //                        0.8 kg × $56.000 = $44.800 (sobrecobro — bug)
    const res = await POST(makeRequest({
      items: [{ producto_id: PRODUCTO_ID, cantidad: 0.8, es_granel: true }],
      metodoPago: "efectivo",
    }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_total: 8000, // 0.8 × 10000 — NO 44800 (0.8 × 56000)
    }));
  });

  // I-61: mismo producto sin es_granel usa precio de lista
  it("I-61: item sin es_granel del mismo producto usa precio de lista ($56.000)", async () => {
    // 1 unidad × $56.000 = $56.000
    const res = await POST(makeRequest({
      items: [{ producto_id: PRODUCTO_ID, cantidad: 1, es_granel: false }],
      metodoPago: "efectivo",
    }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_total: 56000,
    }));
  });

  // I-62: Prueba 2 del reporte — 0.2 kg × $10.000 = $2.000
  it("I-62: 0.2 kg granel a $10.000/kg resulta en total $2.000, no $11.200", async () => {
    const res = await POST(makeRequest({
      items: [{ producto_id: PRODUCTO_ID, cantidad: 0.2, es_granel: true }],
      metodoPago: "efectivo",
    }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_total: 2000, // 0.2 × 10000 — NO 11200 (0.2 × 56000)
    }));
  });

  // I-63: p_items recibe es_granel para que el stored procedure registre el tipo de venta
  it("I-63: p_items enviado al RPC incluye es_granel:true para venta a granel", async () => {
    await POST(makeRequest({
      items: [{ producto_id: PRODUCTO_ID, cantidad: 0.5, es_granel: true, gramos: 500 }],
      metodoPago: "efectivo",
    }));
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_items: expect.arrayContaining([
        expect.objectContaining({ es_granel: true, gramos: 500 }),
      ]),
    }));
  });
});

// ── Consumo alertas desde mascotas ────────────────────────────────────────────

const MASCOTA_ID = "123e4567-e89b-12d3-a456-426614174040";
const ITEM_CON_MASCOTA = { producto_id: PRODUCTO_ID, cantidad: 1, mascota_id: MASCOTA_ID };

function setupConsumoAlerta() {
  let productosCall = 0;
  mockFrom.mockImplementation((table: string) => {
    if (table === "productos") {
      productosCall++;
      if (productosCall === 1) {
        return { select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }) };
      }
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [], error: null }) };
    }
    if (table === "stores") {
      return {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false, email_reminder_dias_aviso: 5 }, error: null }),
      };
    }
    if (table === "clientes") {
      return {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { rut: "11111111-1" }, error: null }),
      };
    }
    return {
      ...mockChain,
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({ data: [], error: null }),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });
}

describe("POST /api/ventas — consumo alertas desde mascotas (I-58/I-59)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupConsumoAlerta();
    mockRpc.mockResolvedValue({ data: DB_VENTA, error: null });
  });

  // I-58: consumo_alertas gestionado en el stored procedure vía p_items + p_dias_aviso
  it("I-58: items con mascota_id y p_dias_aviso se pasan al RPC para consumo_alertas", async () => {
    await POST(makeRequest({
      items: [ITEM_CON_MASCOTA],
      metodoPago: "efectivo",
      clienteId: CLIENTE_ID,
    }));

    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_items: expect.arrayContaining([expect.objectContaining({ mascota_id: MASCOTA_ID })]),
      p_dias_aviso: 5,
    }));
  });

  // I-59: la lógica de gramos_porcion está en el SP; el route siempre pasa el item con mascota_id
  it("I-59: el RPC recibe el item con mascota_id (SP maneja la lógica de gramos internamente)", async () => {
    await POST(makeRequest({
      items: [ITEM_CON_MASCOTA],
      metodoPago: "efectivo",
      clienteId: CLIENTE_ID,
    }));

    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_items: expect.arrayContaining([expect.objectContaining({ mascota_id: MASCOTA_ID })]),
    }));
  });
});
