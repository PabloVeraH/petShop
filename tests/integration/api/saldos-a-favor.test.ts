import { GET, POST } from "@/app/api/saldos-a-favor/route";
import { NextRequest } from "next/server";

jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return {
    ...actual,
    // after() requiere request scope real (lanza fuera de él). Los Route
    // Handlers ahora usan withErrorLogging (src/lib/audit.ts), que agenda el
    // log de errores vía after() — mismo patrón que tests/integration/api/
    // ventas*.test.ts.
    after: jest.fn((cb: () => void) => cb()),
  };
});
jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";

const STORE_ID   = "123e4567-e89b-12d3-a456-426614174000";
const CLIENTE_ID = "123e4567-e89b-12d3-a456-426614174010";
const VENTA_ID   = "123e4567-e89b-12d3-a456-426614174011";

describe("GET /api/saldos-a-favor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: STORE_ID });
  });

  it("obtiene saldo disponible del cliente", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { saldo_disponible: 5000 },
        error: null,
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest(`http://localhost/api/saldos-a-favor?clienteId=${CLIENTE_ID}`);
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.saldo_disponible).toBe(5000);
  });

  it("retorna 0 si cliente no tiene saldo registrado", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "JSON object requested, multiple (or no) rows found", code: "PGRST116" },
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest(`http://localhost/api/saldos-a-favor?clienteId=${CLIENTE_ID}`);
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.saldo_disponible).toBe(0);
  });

  it("I-320: retorna 500 si hay un error real de base de datos", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "connection refused", code: "CONN_ERR" },
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest(`http://localhost/api/saldos-a-favor?clienteId=${CLIENTE_ID}`);
    const res = await GET(req);

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Error consultando saldo");
  });

  it("retorna 400 sin clienteId", async () => {
    const req = new NextRequest("http://localhost/api/saldos-a-favor");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest(`http://localhost/api/saldos-a-favor?clienteId=${CLIENTE_ID}`);
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/saldos-a-favor (usar saldo en compra)", () => {
  let mockRpc: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: STORE_ID });
    mockRpc = jest.fn();
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(),
      rpc: mockRpc,
    });
  });

  function makeReq(body: object) {
    return new NextRequest("http://localhost/api/saldos-a-favor", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // REGRESIÓN: el gasto de saldo (decremento + registro del pago) ahora se
  // hace en una sola transacción atómica vía RPC (gastar_saldo_a_favor_pago),
  // no vía SELECT en JS seguido de INSERT + UPDATE separados — ese patrón
  // permitía un doble gasto real bajo dos requests concurrentes (ambos leen
  // el mismo saldo_disponible antes de que cualquiera de los dos escriba).
  it("usa saldo a favor en compra exitosamente vía RPC atómico", async () => {
    mockRpc.mockResolvedValue({ data: [{ pago_id: "pago-1", saldo_nuevo: 2000 }], error: null });

    const res = await POST(makeReq({ clienteId: CLIENTE_ID, ventaId: VENTA_ID, monto: 3000 }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.pagoId).toBe("pago-1");
    expect(data.montoUsado).toBe(3000);
    expect(data.saldoDisponibleNuevo).toBe(2000);

    expect(mockRpc).toHaveBeenCalledWith("gastar_saldo_a_favor_pago", {
      p_store_id: STORE_ID,
      p_cliente_id: CLIENTE_ID,
      p_venta_id: VENTA_ID,
      p_monto: 3000,
    });
  });

  // REGRESIÓN — doble gasto real: el patrón anterior (SELECT en JS, luego
  // INSERT del pago, luego UPDATE con el valor calculado en la aplicación)
  // permitía que dos requests concurrentes leyeran el MISMO saldo_disponible
  // antes de que cualquiera escribiera, gastando más del saldo real.
  //
  // La garantía de atomicidad real vive en el SQL de gastar_saldo_a_favor_pago
  // (UPDATE condicional bajo lock de fila — ver migrations/051) y NO puede
  // demostrarse con mocks de Jest, que no ejecutan I/O paralelo real; eso se
  // verifica contra Postgres real (ver tarea de verificación de infra). Lo que
  // SÍ se puede probar aquí es que la ruta trata correctamente el resultado
  // que el RPC atómico devolvería para un segundo intento que llega después de
  // que el primero ya consumió el saldo: sin filas (sin éxito, no un
  // "saldoDisponible" stale calculado en JS).
  it("REGRESIÓN: un segundo intento tras consumirse el saldo es rechazado por el RPC, no por un valor stale calculado en JS", async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null }); // el RPC ya no encuentra saldo suficiente
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { saldo_disponible: 0 }, error: null }),
      }),
      rpc: mockRpc,
    });

    const res = await POST(makeReq({ clienteId: CLIENTE_ID, ventaId: VENTA_ID, monto: 3000 }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("Saldo insuficiente");
    // No se inserta ningún pago cuando el RPC no devuelve fila
    expect(data.pagoId).toBeUndefined();
  });

  it("rechaza uso de saldo si RPC retorna vacío (saldo insuficiente)", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { saldo_disponible: 2000 }, error: null }),
      }),
      rpc: mockRpc,
    });

    const res = await POST(makeReq({ clienteId: CLIENTE_ID, ventaId: VENTA_ID, monto: 5000 }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("Saldo insuficiente");
    expect(data.error).toContain("2000");
  });

  it("usa saldo total disponible (monto = saldo)", async () => {
    mockRpc.mockResolvedValue({ data: [{ pago_id: "pago-2", saldo_nuevo: 0 }], error: null });

    const res = await POST(makeReq({ clienteId: CLIENTE_ID, ventaId: VENTA_ID, monto: 5000 }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.saldoDisponibleNuevo).toBe(0);
  });

  it("retorna 500 si el RPC falla con un error de base de datos", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });

    const res = await POST(makeReq({ clienteId: CLIENTE_ID, ventaId: VENTA_ID, monto: 1000 }));
    expect(res.status).toBe(500);
  });

  it("retorna 400 sin clienteId", async () => {
    const res = await POST(makeReq({ ventaId: VENTA_ID, monto: 1000 }));
    expect(res.status).toBe(400);
  });

  it("retorna 400 sin ventaId", async () => {
    const res = await POST(makeReq({ clienteId: CLIENTE_ID, monto: 1000 }));
    expect(res.status).toBe(400);
  });

  it("retorna 400 si monto <= 0", async () => {
    const res = await POST(makeReq({ clienteId: CLIENTE_ID, ventaId: VENTA_ID, monto: 0 }));
    expect(res.status).toBe(400);
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const res = await POST(makeReq({ clienteId: CLIENTE_ID, ventaId: VENTA_ID, monto: 1000 }));
    expect(res.status).toBe(401);
  });

  it("registra auditoría con el pagoId devuelto por el RPC", async () => {
    mockRpc.mockResolvedValue({ data: [{ pago_id: "pago-3", saldo_nuevo: 3000 }], error: null });

    const res = await POST(makeReq({ clienteId: CLIENTE_ID, ventaId: VENTA_ID, monto: 2000 }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.pagoId).toBe("pago-3");
  });
});
