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

jest.mock("@/lib/contabilidad/generador-asientos", () => {
  const actual = jest.requireActual("@/lib/contabilidad/generador-asientos");
  return {
    ...actual,
    crearAsiento: jest.fn().mockResolvedValue("asiento-uuid"),
  };
});

import { POST } from "@/app/api/ventas/route";
import { crearAsiento } from "@/lib/contabilidad/generador-asientos";
import { CUENTAS } from "@/lib/contabilidad/types";
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

const DB_PRODUCTO = { id: PRODUCTO_ID, nombre: "Cama Mascota Talla M", precio: 10000, precio_oferta: null, en_oferta: false, stock: 10, costo: 4000 };
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
        single: jest.fn().mockResolvedValue({ data: { rut: "11111111-1", nombre: "Carlos Rojas" }, error: null }),
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

// ── Suite ─────────────────────────────────────────────────────────────────────

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

  // I-300
  it("I-300: rechaza debito sin numeroTransaccion con 400", async () => {
    const res = await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "debito" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("número de transacción");
  });

  // I-301
  it("I-301: rechaza credito sin numeroTransaccion con 400", async () => {
    const res = await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "credito" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("número de transacción");
  });

  // I-302
  it("I-302: rechaza transferencia sin numeroTransaccion con 400", async () => {
    const res = await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "transferencia" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("número de transacción");
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

  // I-280: descripcion del asiento incluye metodo de pago y nombre del cliente (sin UUID)
  it("I-280: descripcion del asiento incluye metodo de pago y nombre del cliente (sin UUID)", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID }));
    expect(crearAsiento).toHaveBeenCalledWith(expect.objectContaining({
      tipoMovimiento: "VENTA",
    }));

    const callArgs = (crearAsiento as jest.Mock).mock.calls[0][0];
    expect(callArgs.descripcion).toBe("Venta efectivo a Carlos Rojas");
    // No debe contener el numero_comprobante (UUID truncado)
    expect(callArgs.descripcion).not.toContain("ABC12345");
    expect(callArgs.descripcion).not.toContain("20260525");
  });

  // I-279: REGRESIÓN — el COGS debe registrarse en un asiento SEPARADO del de venta.
  // Bug: antes, las líneas de COGS se mezclaban en el mismo crearAsiento que las de
  // venta, inflando total_debito (ej: venta $11.682 + COGS $6.500 = $18.182 en Libro Diario).
  it("I-279: REGRESIÓN — COGS se registra en asiento separado; el asiento de venta solo contiene líneas de ingreso", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo", clienteId: CLIENTE_ID }));

    // crearAsiento debe llamarse DOS VECES: asiento de venta + asiento de COGS
    expect(crearAsiento).toHaveBeenCalledTimes(2);

    // Primera llamada: asiento de ingreso (venta)
    const ventaCall = (crearAsiento as jest.Mock).mock.calls[0][0];
    expect(ventaCall.tipoMovimiento).toBe("VENTA");

    // El asiento de venta NO debe contener líneas de COGS ni de Inventario
    const tieneLineaCOGS = ventaCall.lineas.some(
      (l: { cuentaCodigo: string }) => l.cuentaCodigo === CUENTAS.COGS.codigo
    );
    expect(tieneLineaCOGS).toBe(false);
    const tieneLineaInventario = ventaCall.lineas.some(
      (l: { cuentaCodigo: string }) => l.cuentaCodigo === CUENTAS.INVENTARIO.codigo
    );
    expect(tieneLineaInventario).toBe(false);

    // total_debito del asiento de venta = $20,000 (precio $10,000 × 2 unidades), NO $28,000
    const totalDebitoVenta = ventaCall.lineas.reduce((s: number, l: { debito: number }) => s + l.debito, 0);
    expect(totalDebitoVenta).toBe(20000);

    // Segunda llamada: asiento COGS
    const cogsCall = (crearAsiento as jest.Mock).mock.calls[1][0];
    const lineaCOGS = cogsCall.lineas.find(
      (l: { cuentaCodigo: string }) => l.cuentaCodigo === CUENTAS.COGS.codigo
    );
    expect(lineaCOGS).toBeDefined();
    expect(lineaCOGS.debito).toBe(8000); // 2 × $4,000 costo
    expect(lineaCOGS.credito).toBe(0);

    const lineaInventario = cogsCall.lineas.find(
      (l: { cuentaCodigo: string }) => l.cuentaCodigo === CUENTAS.INVENTARIO.codigo
    );
    expect(lineaInventario).toBeDefined();
    expect(lineaInventario.credito).toBe(8000);
    expect(lineaInventario.debito).toBe(0);
  });

  // I-281: REGRESIÓN — cuando costoTotal=0 (costo del producto no configurado),
  // crearAsiento se llama solo UNA vez (no hay asiento COGS vacío).
  it("I-281: cuando costo del producto es $0 no se crea asiento COGS", async () => {
    const productorSinCosto = { ...DB_PRODUCTO, costo: 0 };
    const productorSinCostoSync = { ...DB_PRODUCTO_SYNC };
    let productosCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        productosCall++;
        if (productosCall === 1) {
          // Price lookup: .select().in().eq()
          return { select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [productorSinCosto], error: null }) };
        }
        // Hub sync: .select().eq().in()
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [productorSinCostoSync], error: null }) };
      }
      if (table === "stores") {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false, email_reminder_dias_aviso: 5, fidelizacion_niveles: null }, error: null }) };
      }
      return { ...mockChain, select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [], error: null }), single: jest.fn().mockResolvedValue({ data: null, error: null }) };
    });

    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo" }));

    // Solo debe llamarse UNA vez (no hay COGS si costoTotal=0)
    expect(crearAsiento).toHaveBeenCalledTimes(1);
    const ventaCall = (crearAsiento as jest.Mock).mock.calls[0][0];
    expect(ventaCall.tipoMovimiento).toBe("VENTA");
  });

  // I-282: REGRESIÓN — el RPC recibe p_numero_comprobante en formato legible (YYYYMMDD-XXXXXXXX),
  // no un UUID. Este valor es el que la función SQL escribe en stock_movements.notas como
  // 'Venta ' || v_venta.numero_comprobante. El bug previo usaba v_venta.id (UUID técnico).
  it("I-282: REGRESIÓN — p_numero_comprobante pasado al RPC es legible (YYYYMMDD-XXXXXXXX), no un UUID", async () => {
    await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "efectivo" }));

    expect(mockRpc).toHaveBeenCalledWith(
      "crear_venta_tx",
      expect.objectContaining({
        p_numero_comprobante: expect.stringMatching(/^\d{8}-[A-Z0-9]{8}$/),
      })
    );

    // Refuerzo: no debe ser un UUID (8-4-4-4-12 hex)
    const rpcArgs = mockRpc.mock.calls[0][1] as Record<string, string>;
    expect(rpcArgs.p_numero_comprobante).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
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

  // I-303
  it("I-303: debito con numeroTransaccion valido → 200", async () => {
    const res = await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "debito", numeroTransaccion: "TRX123" }));
    expect(res.status).toBe(200);
  });

  // I-304
  it("I-304: credito con numeroTransaccion valido → 200", async () => {
    const res = await POST(makeRequest({ items: [VALID_ITEM], metodoPago: "credito", numeroTransaccion: "TRX456" }));
    expect(res.status).toBe(200);
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

  // I-441 — renumerado desde I-54 (colisión: I-54 ya usado en
  // inventario.patch.test.ts para el fix de salida de stock, ticket Trello
  // 6a5f9a8c29a2a067617111f7; este I-54 nunca estuvo registrado en
  // spec-registry.md — ver AGENTS.md §2.3)
  it("I-441: procedencia se incluye junto con metodo_pago y total en el RPC", async () => {
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
      items: [{ producto_id: PRODUCTO_ID, cantidad: 0.8, es_granel: true, gramos: 800 }],
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
      items: [{ producto_id: PRODUCTO_ID, cantidad: 0.2, es_granel: true, gramos: 200 }],
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

  // I-64: REGRESIÓN — producto granel sin precio_venta_kg → 400 explícito, no sobrecobro silencioso
  it("I-64: producto con es_granel pero sin precio_venta_kg en DB retorna 400", async () => {
    // Simular producto sin precio_venta_kg configurado
    const productoSinPrecioKg = { ...DB_PRODUCTO_GRANEL, precio_venta_kg: null };
    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        return { select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [productoSinPrecioKg], error: null }) };
      }
      if (table === "stores") {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false }, error: null }) };
      }
      return { ...mockChain, select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: null, error: null }) };
    });

    const res = await POST(makeRequest({
      items: [{ producto_id: PRODUCTO_ID, cantidad: 0.5, es_granel: true, gramos: 500 }],
      metodoPago: "efectivo",
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/precio_venta_kg/);
    // El RPC nunca debe ser llamado cuando el precio granel no está configurado
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // I-65: REGRESIÓN — es_granel=true sin gramos es rechazado por Zod antes de llegar a la BD
  it("I-65: es_granel=true sin gramos retorna 400 por validación Zod", async () => {
    const res = await POST(makeRequest({
      items: [{ producto_id: PRODUCTO_ID, cantidad: 0.5, es_granel: true }], // sin gramos
      metodoPago: "efectivo",
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/gramos/i);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ── IVA: fórmula de extracción (REGRESIÓN) ───────────────────────────────────
// Bug: el backend usaba total × 0.19 (aditiva) en lugar de total × (0.19/1.19) (extracción),
// sobreestimando el IVA registrado en BD. Los precios del catálogo ya incluyen IVA.

describe("POST /api/ventas — IVA correcto enviado al RPC (I-405)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupHappyPath();
    mockRpc.mockResolvedValue({ data: DB_VENTA, error: null });
  });

  // I-405: REGRESIÓN — Whiskas 1kg $15.458 → IVA persistido = $2.468, no $2.937
  it("I-405: producto $15.458 con IVA incluido → p_impuesto = $2.468 (extracción, no aditiva)", async () => {
    const productoWhiskas = { ...DB_PRODUCTO, precio: 15458, precio_oferta: null, en_oferta: false };
    const productoWhiskasSync = { ...DB_PRODUCTO_SYNC, precio: 15458 };
    let productosCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        productosCall++;
        if (productosCall === 1) {
          // Price lookup: .select().in().eq()
          return { select: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [productoWhiskas], error: null }) };
        }
        // Hub sync lookup: .select().eq().in()
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [productoWhiskasSync], error: null }) };
      }
      if (table === "stores") {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false, email_reminder_dias_aviso: 5, fidelizacion_niveles: null }, error: null }) };
      }
      return { ...mockChain, select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: null, error: null }) };
    });

    const res = await POST(makeRequest({ items: [{ producto_id: PRODUCTO_ID, cantidad: 1 }], metodoPago: "efectivo" }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_total:    15458,
      p_impuesto: 2468,  // 15458 × (0.19/1.19) = 2467.79 → 2468  (NO 2937 = 15458×0.19)
    }));
  });
});

// ── Worker clerk ID ────────────────────────────────────────────────────────────

describe("POST /api/ventas — workerClerkId (I-68)", () => {
  function setupWorkerCapture() {
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
        return { ...mockChain, select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { whatsapp_enabled: false, email_reminder_dias_aviso: 5 }, error: null }) };
      }
      if (table === "clientes") {
        return { ...mockChain, select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: { nombre: "Cliente Test" }, error: null }) };
      }
      return { ...mockChain, select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data: [], error: null }), single: jest.fn().mockResolvedValue({ data: null, error: null }) };
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setupWorkerCapture();
    mockRpc.mockResolvedValue({ data: DB_VENTA, error: null });
  });

  // I-68: workerClerkId se envía al RPC como p_worker_clerk_id
  // Si se omite, debe usar el userId del token (ctx.userId) como fallback
  it("I-68: workerClerkId proporcionado → se pasa al RPC; si se omite → fallback a ctx.userId", async () => {
    await POST(makeRequest({
      items: [VALID_ITEM],
      metodoPago: "efectivo",
      workerClerkId: "user-worker-123",
    }));
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_worker_clerk_id: "user-worker-123",
    }));

    jest.clearAllMocks();
    setupWorkerCapture();
    mockRpc.mockResolvedValue({ data: DB_VENTA, error: null });

    await POST(makeRequest({
      items: [VALID_ITEM],
      metodoPago: "efectivo",
    }));
    expect(mockRpc).toHaveBeenCalledWith("crear_venta_tx", expect.objectContaining({
      p_worker_clerk_id: "user-1", // fallback al userId autenticado
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
        single: jest.fn().mockResolvedValue({ data: { rut: "11111111-1", nombre: "Test Cliente" }, error: null }),
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

// ── Sobrestock ───────────────────────────────────────────────────────────────
//
// REGRESIÓN — I-67: el backend debe rechazar ventas que superen el stock disponible
// Bug: el route no validaba stock antes de llamar al RPC. Un vendedor podía vender
// 7 unidades de un producto con stock 6 sin ningún error.

describe("POST /api/ventas — sobrestock (I-67)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // I-67: intentar vender más unidades de las disponibles → 422
  it("I-67: rechaza venta con sobrestock → 422 con mensaje de error claro", async () => {
    const PRODUCTO_STOCK_6 = { id: PRODUCTO_ID, nombre: "Cama Mascota Talla M", precio: 24990, precio_oferta: null, en_oferta: false, stock: 6 };

    let productosCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "productos") {
        productosCall++;
        if (productosCall === 1) {
          return {
            select: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({ data: [PRODUCTO_STOCK_6], error: null }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    // Intentar vender 7 unidades con stock de 6
    const res = await POST(makeRequest({
      items: [{ producto_id: PRODUCTO_ID, cantidad: 7 }],
      metodoPago: "efectivo",
    }));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("Stock insuficiente");
    expect(body.error).toContain("Cama Mascota Talla M");
    // El RPC NO debe haberse llamado — el rechazo ocurre antes de la transacción
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
