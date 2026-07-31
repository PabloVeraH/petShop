/**
 * Tests I-458 a I-463: POST /api/contabilidad/aporte-capital
 *
 * Mecanismo agregado para el ticket Trello 6a61195cfc6f97edc3c0a3b0: el
 * módulo contable no tenía ningún tipo_movimiento para registrar dinero
 * ingresado por los socios/dueños (no proviene de una venta), dejando
 * Caja/Banco estructuralmente expuestas a saldo negativo cuando los pagos a
 * proveedores por esa cuenta superan sus cobros — verificado contra la BD
 * real (proyecto wnxrdbnvreofrrmhcybc): 0 tipo_movimiento = 'APORTE_CAPITAL'
 * existía antes de este cambio.
 *
 * I-458: retorna 401 si no autenticado
 * I-459: retorna 403 si el usuario no es storeAdmin ni systemAdmin
 * I-460: retorna 400 si monto no es positivo
 * I-461: retorna 400 si cuentaDestino no es "caja" ni "banco"
 * I-462: crea el asiento con tipoMovimiento APORTE_CAPITAL y las líneas de
 *        lineasAporteCapital para la cuenta destino solicitada
 * I-463: retorna 500 si crearAsiento falla (ej. asiento desbalanceado)
 */
import { NextRequest } from "next/server";

const mockAuth = jest.fn();

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
jest.mock("@/lib/contabilidad/generador-asientos", () => ({
  ...jest.requireActual("@/lib/contabilidad/generador-asientos"),
  crearAsiento: jest.fn().mockResolvedValue("asiento-aporte-uuid"),
}));
jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";
import { crearAsiento } from "@/lib/contabilidad/generador-asientos";
import { POST } from "@/app/api/contabilidad/aporte-capital/route";

const STORE_ID = "store-uuid-aporte";

function makeRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/contabilidad/aporte-capital", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function genericChain() {
  const chain: Record<string, jest.Mock> & { then?: (resolve: (v: unknown) => unknown) => unknown } = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
  };
  chain.then = (resolve) => resolve({ data: null, error: null });
  return chain;
}

describe("POST /api/contabilidad/aporte-capital", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: STORE_ID, userId: "user-001" });
    mockAuth.mockResolvedValue({
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: STORE_ID } },
    });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(genericChain()),
    });
    (crearAsiento as jest.Mock).mockResolvedValue("asiento-aporte-uuid");
  });

  // I-458
  it("I-458: retorna 401 si no autenticado", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const res = await POST(makeRequest({ cuentaDestino: "caja", monto: 100000 }));

    expect(res.status).toBe(401);
  });

  // I-459 — REGRESIÓN: registrar un aporte de capital es una acción contable
  // sensible; sin requireStoreAdmin, cualquier storeWorker podría inyectar
  // dinero ficticio en Caja/Banco.
  it("I-459: REGRESIÓN — retorna 403 cuando el usuario autenticado no es storeAdmin ni systemAdmin", async () => {
    mockAuth.mockResolvedValue({
      sessionClaims: { publicMetadata: { storeWorker: true, storeId: STORE_ID } },
    });

    const res = await POST(makeRequest({ cuentaDestino: "caja", monto: 100000 }));

    expect(res.status).toBe(403);
    expect(crearAsiento).not.toHaveBeenCalled();
  });

  // I-460
  it("I-460: retorna 400 si monto no es positivo", async () => {
    const res = await POST(makeRequest({ cuentaDestino: "caja", monto: 0 }));

    expect(res.status).toBe(400);
    expect(crearAsiento).not.toHaveBeenCalled();
  });

  it("I-460b: retorna 400 si monto es negativo", async () => {
    const res = await POST(makeRequest({ cuentaDestino: "caja", monto: -5000 }));

    expect(res.status).toBe(400);
    expect(crearAsiento).not.toHaveBeenCalled();
  });

  // I-461
  it("I-461: retorna 400 si cuentaDestino no es 'caja' ni 'banco'", async () => {
    const res = await POST(makeRequest({ cuentaDestino: "cripto", monto: 100000 }));

    expect(res.status).toBe(400);
    expect(crearAsiento).not.toHaveBeenCalled();
  });

  // I-462
  it("I-462: crea el asiento con tipoMovimiento APORTE_CAPITAL y líneas Dr Banco / Cr Capital", async () => {
    const res = await POST(makeRequest({ cuentaDestino: "banco", monto: 500000, descripcion: "Aporte socio Juan" }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.asientoId).toBe("asiento-aporte-uuid");

    expect(crearAsiento).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: STORE_ID,
        tipoMovimiento: "APORTE_CAPITAL",
        descripcion: "Aporte socio Juan",
      })
    );

    const callArgs = (crearAsiento as jest.Mock).mock.calls[0][0];
    const lineas = callArgs.lineas as Array<{ cuentaCodigo: string; debito: number; credito: number }>;
    const debitos = lineas.reduce((s, l) => s + l.debito, 0);
    const creditos = lineas.reduce((s, l) => s + l.credito, 0);
    expect(debitos).toBe(500000);
    expect(creditos).toBe(500000);
  });

  // I-463
  it("I-463: retorna 500 si crearAsiento retorna null", async () => {
    (crearAsiento as jest.Mock).mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ cuentaDestino: "caja", monto: 100000 }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
