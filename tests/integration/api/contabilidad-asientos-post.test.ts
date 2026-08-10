/**
 * Tests I-506 a I-508: POST /api/contabilidad/asientos
 *
 * No existía cobertura de integración previa para el POST de este endpoint
 * (solo A-DEL-* cubre el DELETE de /api/contabilidad/asientos/[id]).
 *
 * I-506: REGRESIÓN (ticket Trello 6a77ed665c4d8a8c726111ac, hallazgo
 *        extendido durante esa revisión) — período de la fecha ya cerrado
 *        (existe CIERRE_MES) → 409 con mensaje accionable, NO 500 genérico;
 *        crearAsiento no se llama. Mismo patrón que I-504 en
 *        aporte-capital.
 * I-507: fecha dentro de un período abierto → 201 y crearAsiento recibe esa
 *        fecha con tipoMovimiento AJUSTE y creadoPor "manual"
 * I-508: crearAsiento retorna null (no relacionado a período) → 500
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
jest.mock("@/lib/contabilidad/generador-asientos", () => ({
  ...jest.requireActual("@/lib/contabilidad/generador-asientos"),
  crearAsiento: jest.fn().mockResolvedValue("asiento-manual-uuid"),
}));

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";
import { crearAsiento } from "@/lib/contabilidad/generador-asientos";
import { POST } from "@/app/api/contabilidad/asientos/route";

const STORE_ID = "store-uuid-asientos";

function makeRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/contabilidad/asientos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function genericChain() {
  const chain: Record<string, jest.Mock> & { then?: (resolve: (v: unknown) => unknown) => unknown } = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: { id: "asiento-manual-uuid" }, error: null }),
  };
  chain.then = (resolve) => resolve({ data: null, error: null }); // sin cierre por defecto
  return chain;
}

function cierreChain() {
  const chain: Record<string, jest.Mock> & { then?: (resolve: (v: unknown) => unknown) => unknown } = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    // Si el código (pre-fix) llegara a ignorar este chequeo y avanzara hasta
    // el refetch final (.single()), que no crashee — así el test falla por
    // la aserción de status esperada (409), no por una excepción no
    // relacionada.
    single: jest.fn().mockResolvedValue({ data: { id: "asiento-manual-uuid" }, error: null }),
  };
  chain.then = (resolve) => resolve({ data: [{ id: "cierre-1" }], error: null });
  return chain;
}

const LINEAS_VALIDAS = [
  { cuenta_codigo: "111001", cuenta_nombre: "Caja", debito: 10000, credito: 0 },
  { cuenta_codigo: "410101", cuenta_nombre: "Venta de Productos", debito: 0, credito: 10000 },
];

describe("POST /api/contabilidad/asientos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: STORE_ID, userId: "user-001" });
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(genericChain()),
    });
    (crearAsiento as jest.Mock).mockResolvedValue("asiento-manual-uuid");
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const res = await POST(makeRequest({ fecha: "2026-09-05", descripcion: "Ajuste manual", lineas: LINEAS_VALIDAS }));

    expect(res.status).toBe(401);
  });

  it("retorna 400 con fecha en formato inválido", async () => {
    const res = await POST(makeRequest({ fecha: "05-09-2026", descripcion: "Ajuste manual", lineas: LINEAS_VALIDAS }));
    expect(res.status).toBe(400);
  });

  it("retorna 400 si el asiento no está balanceado", async () => {
    const res = await POST(makeRequest({
      fecha: "2026-09-05",
      descripcion: "Ajuste desbalanceado",
      lineas: [
        { cuenta_codigo: "111001", cuenta_nombre: "Caja", debito: 10000, credito: 0 },
        { cuenta_codigo: "410101", cuenta_nombre: "Venta de Productos", debito: 0, credito: 5000 },
      ],
    }));
    expect(res.status).toBe(400);
    expect(crearAsiento).not.toHaveBeenCalled();
  });

  // I-506 — REGRESIÓN: sin este chequeo, un asiento manual con fecha en
  // período cerrado pasaba a crearAsiento, que rechazaba con null (guard de
  // período cerrado — todo tipoMovimiento salvo CIERRE_MES/ANULACION_VENTA/
  // backfill), y la ruta devolvía el 500 genérico "Error creando asiento" —
  // mismo defecto y mismo fix que aporte-capital (ticket Trello
  // 6a77ed665c4d8a8c726111ac).
  it("I-506: REGRESIÓN — período de la fecha ya cerrado → 409 accionable, no 500; crearAsiento no se llama", async () => {
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(cierreChain()),
    });

    const res = await POST(makeRequest({ fecha: "2026-08-15", descripcion: "Ajuste retroactivo", lineas: LINEAS_VALIDAS }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("2026-08");
    expect(body.error).toContain("cerrado");
    expect(crearAsiento).not.toHaveBeenCalled();
  });

  // I-507 — fecha dentro de un período abierto: crearAsiento recibe la fecha
  // exacta del body, con tipoMovimiento AJUSTE y creadoPor "manual".
  it("I-507: fecha dentro de un período abierto → 201 y crearAsiento recibe esa fecha", async () => {
    const res = await POST(makeRequest({ fecha: "2026-09-05", descripcion: "Ajuste manual", lineas: LINEAS_VALIDAS }));

    expect(res.status).toBe(201);
    expect(crearAsiento).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: STORE_ID,
        fecha: "2026-09-05",
        tipoMovimiento: "AJUSTE",
        creadoPor: "manual",
      })
    );
  });

  // I-508 — un null de crearAsiento por una causa NO relacionada a período
  // (ej. colisión de numero_asiento agotando reintentos) sigue devolviendo
  // 500 — el chequeo de período no reemplaza ese manejo de error existente.
  it("I-508: crearAsiento retorna null por una causa no relacionada a período → 500", async () => {
    (crearAsiento as jest.Mock).mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ fecha: "2026-09-05", descripcion: "Ajuste manual", lineas: LINEAS_VALIDAS }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
