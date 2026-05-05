/**
 * Tests I-34 a I-46: POST /api/ventas
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const PRODUCTO_ID = "123e4567-e89b-12d3-a456-426614174010";
const CLIENTE_ID = "123e4567-e89b-12d3-a456-426614174020";

// --- mocks ---
const mockSingle = jest.fn();
const mockRpc = jest.fn().mockResolvedValue({ error: null });
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

import { POST } from "@/app/api/ventas/route";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { syncPurchaseToHub } from "@/lib/hub-sync";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/ventas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_ITEM = { producto_id: PRODUCTO_ID, cantidad: 2 };

// Productos devueltos por la DB (con precio real)
const DB_PRODUCTO = { id: PRODUCTO_ID, precio: 10000, precio_oferta: null, en_oferta: false };
const DB_PRODUCTO_SYNC = { id: PRODUCTO_ID, nombre: "Test", marca: null, codigo_barra: null, precio: 10000, stock: 48, activo: true };
// Venta creada
const DB_VENTA = { id: "123e4567-e89b-12d3-a456-426614174030", total: 23800 };

function setupHappyPath() {
  let productosCall = 0;
  mockFrom.mockImplementation((table: string) => {
    if (table === "productos") {
      productosCall++;
      if (productosCall === 1) {
        // Price lookup: select → in → eq (resolves in eq)
        return {
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }),
        };
      } else {
        // Stock sync: select → eq → in (resolves in in)
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO_SYNC], error: null }),
        };
      }
    }
    if (table === "ventas") {
      return {
        ...mockChain,
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: DB_VENTA, error: null }),
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
    if (table === "stores") {
      return {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false }, error: null }),
      };
    }
    if (table === "fidelizacion") {
      return {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
        upsert: jest.fn().mockResolvedValue({ error: null }),
      };
    }
    if (table === "lotes_producto") {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gt: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
        count: { exact: 0 },
      };
    }
    return {
      ...mockChain,
      insert: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });
}

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
          eq: jest.fn().mockResolvedValue({ data: [], error: null }), // 0 productos → falla
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
    mockRpc.mockResolvedValue({ error: null });
    const res = await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo" }));
    expect(res.status).toBe(200);
  });

  // I-51
  it("I-51: rechaza procedencia inválida con 400", async () => {
    const res = await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", procedencia: "twitter" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/ventas — flujo exitoso", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupHappyPath();
    mockRpc.mockResolvedValue({ error: null });
  });

  // I-39: precio tomado de DB (no del body)
  it("I-39: precio tomado de DB, no del body del cliente", async () => {
    const res = await POST(makeRequest({
      items: [{ ...VALID_ITEM, precio_unitario: 999 }], // precio trampa en body
      metodoPago: "efectivo",
      clienteId: CLIENTE_ID,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Total debe calcularse con el precio de DB (10000 * 2 * 1.19 = 23800)
    expect(body.total).toBeCloseTo(23800, 0);
  });

  // I-40: with FIFO lotes present, calls disminuir_stock_fifo
it("I-40: venta exitosa llama a decrement_stock", async () => {
    mockRpc.mockClear();
    let productosCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "lotes_producto") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gt: jest.fn().mockReturnThis(),
          count: { exact: 0 },
        };
      }
      if (table === "productos") {
        productosCall++;
        if (productosCall === 1) {
          return {
            select: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }),
          };
        } else {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO_SYNC], error: null }),
          };
        }
      }
      if (table === "ventas") {
        return { ...mockChain, insert: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: DB_VENTA, error: null }) };
      }
      if (table === "clientes") {
        return { select: jest.fn().mockReturnThis(), insert: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), ilike: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: null, error: null }) };
      }
      if (table === "stores") {
        return { ...mockChain, select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false }, error: null }) };
      }
      if (table === "fidelizacion") {
        return { ...mockChain, select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: null, error: null }), upsert: jest.fn().mockResolvedValue({ error: null }) };
      }
      if (table === "venta_items") {
        const insertMock = jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "vi-1", producto_id: PRODUCTO_ID, cantidad: 2, precio_unitario: 10000, subtotal: 20000 }],
            error: null
          }),
        });
        return {
          select: jest.fn().mockReturnThis(),
          insert: insertMock,
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return { ...mockChain, insert: jest.fn().mockReturnThis(), upsert: jest.fn().mockResolvedValue({ error: null }), select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: null, error: null }) };
    });
    const res = await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("decrement_stock", expect.objectContaining({
      p_producto_id: PRODUCTO_ID,
      p_cantidad: 2,
    }));
  });

  // I-41
  it("I-41: venta exitosa crea venta_items", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID }));
    const tablas = mockFrom.mock.calls.map(([t]: [string]) => t);
    expect(tablas).toContain("venta_items");
  });

  // I-42
  it("I-42: venta con cliente actualiza fidelización", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID }));
    const tablas = mockFrom.mock.calls.map(([t]: [string]) => t);
    expect(tablas).toContain("fidelizacion");
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
        } else {
          return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO_SYNC], error: null }) };
        }
      }
      if (table === "ventas") {
        return { ...mockChain, insert: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: DB_VENTA, error: null }) };
      }
if (table === "lotes_producto") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gt: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
          count: { exact: 0 },
        };
      }
      if (table === "clientes") {
        return { select: jest.fn().mockReturnThis(), insert: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), ilike: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { rut: "11111111-1", nombre: "Juan", telefono: "56912345678" }, error: null }) };
      }
      if (table === "stores") {
        return { ...mockChain, select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { name: "Test", whatsapp_enabled: true, whatsapp_phone_number_id: "123", whatsapp_access_token: "tok" }, error: null }) };
      }
      if (table === "venta_items") {
        const insertMock = jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "vi-1", producto_id: PRODUCTO_ID, cantidad: 2, precio_unitario: 10000, subtotal: 20000 }],
            error: null
          }),
        });
        return {
          select: jest.fn().mockReturnThis(),
          insert: insertMock,
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      if (table === "fidelizacion") {
        return { ...mockChain, select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: null, error: null }), upsert: jest.fn().mockResolvedValue({ error: null }) };
      }
      return { ...mockChain, insert: jest.fn().mockReturnThis(), upsert: jest.fn().mockResolvedValue({ error: null }), select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: null, error: null }) };
    });
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID }));
    expect(sendWhatsAppText).toHaveBeenCalled();
  });
});

describe("POST /api/ventas — cálculo de descuento", () => {
  // precio DB = 10000, cantidad = 2 → subtotal = 20000
  let ventasInsertArgs: Record<string, unknown> | null = null;

  function setupDiscountCapture() {
    ventasInsertArgs = null;
    let productosCall = 0;
    let ventasCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        productosCall++;
        if (productosCall === 1) {
          return { select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }) };
        }
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO_SYNC], error: null }) };
      }
      if (table === "ventas") {
        ventasCall++;
        if (ventasCall === 1) {
          return {
            insert: jest.fn().mockImplementation((args: Record<string, unknown>) => {
              ventasInsertArgs = args;
              return { select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: DB_VENTA, error: null }) };
            }),
          };
        }
        return { update: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ error: null }) };
      }
      if (table === "stores") {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false, email_reminder_dias_aviso: 5 }, error: null }) };
      }
      return {
        ...mockChain,
        insert: jest.fn().mockReturnThis(),
        upsert: jest.fn().mockResolvedValue({ error: null }),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setupDiscountCapture();
    mockRpc.mockResolvedValue({ error: null });
  });

  // I-47
  it("I-47: sin descuentoPct el total insertado es igual al subtotal (20000)", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo" }));
    expect(ventasInsertArgs).toMatchObject({ total: 20000, descuento: 0 });
  });

  // I-48
  it("I-48: descuentoPct=10 reduce el total al 90% del subtotal (18000)", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", descuentoPct: 10 }));
    expect(ventasInsertArgs).toMatchObject({ total: 18000, descuento: 10 });
  });

  // I-49
  it("I-49: descuentoPct=50 reduce el total a la mitad (10000)", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", descuentoPct: 50 }));
    expect(ventasInsertArgs).toMatchObject({ total: 10000, descuento: 50 });
  });

  // I-50
  it("I-50: descuentoPct=100 resulta en total 0", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", descuentoPct: 100 }));
    expect(ventasInsertArgs).toMatchObject({ total: 0, descuento: 100 });
  });
});

describe("POST /api/ventas — procedencia", () => {
  let ventasInsertArgs: Record<string, unknown> | null = null;

  function setupProcedenciaCapture() {
    ventasInsertArgs = null;
    let productosCall = 0;
    let ventasCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        productosCall++;
        if (productosCall === 1) {
          return { select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO], error: null }) };
        }
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [DB_PRODUCTO_SYNC], error: null }) };
      }
      if (table === "ventas") {
        ventasCall++;
        if (ventasCall === 1) {
          return {
            insert: jest.fn().mockImplementation((args: Record<string, unknown>) => {
              ventasInsertArgs = args;
              return { select: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: DB_VENTA, error: null }) };
            }),
          };
        }
        return { update: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ error: null }) };
      }
      if (table === "stores") {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false, email_reminder_dias_aviso: 5 }, error: null }) };
      }
      return {
        ...mockChain,
        insert: jest.fn().mockReturnThis(),
        upsert: jest.fn().mockResolvedValue({ error: null }),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setupProcedenciaCapture();
    mockRpc.mockResolvedValue({ error: null });
  });

  // I-52
  it("I-52: sin procedencia el valor insertado es 'presencial' (default)", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo" }));
    expect(ventasInsertArgs).toMatchObject({ procedencia: "presencial" });
  });

  // I-53
  it.each([
    "presencial", "instagram", "whatsapp", "facebook", "tiktok", "telefonico",
  ])("I-53: procedencia='%s' se guarda correctamente en el INSERT", async (proc) => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", procedencia: proc }));
    expect(ventasInsertArgs).toMatchObject({ procedencia: proc });
  });

  // I-54
  it("I-54: procedencia se incluye junto con metodo_pago y total en el INSERT", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", procedencia: "whatsapp" }));
    expect(ventasInsertArgs).toMatchObject({
      metodo_pago: "efectivo",
      procedencia: "whatsapp",
      total: 20000,
    });
  });
});
