/**
 * Test I-734: GET /api/tienda/nombre — nombre de la tienda para cualquier
 * usuario de la tienda (sidebar y recibo del POS). QA 2026-09-27: el
 * storeWorker veía "PetShop" porque GET /api/settings es solo admin (SEC-07,
 * que se mantiene). Este endpoint solo expone `name` y `rut` (I-744: el RUT
 * de la tienda va impreso en el ticket de venta).
 */
import { NextRequest } from "next/server";

const mockGetStoreId = jest.fn();
const mockDeshabilitado = jest.fn().mockResolvedValue(false);
const mockSingle = jest.fn();
const mockEq = jest.fn();
const mockSelect = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: () => mockGetStoreId() }));
jest.mock("@/lib/usuario-habilitado", () => ({ usuarioDeshabilitado: (...a: unknown[]) => mockDeshabilitado(...a) }));
jest.mock("@clerk/nextjs/server", () => ({ auth: () => Promise.resolve({ sessionClaims: {} }) }));
jest.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ from: mockFrom }) }));
jest.mock("@/lib/audit", () => ({ withErrorLogging: (fn: unknown) => fn }));

import { GET } from "@/app/api/tienda/nombre/route";

const STORE_ID = "18d5dab7-0000-4000-8000-000000000001";
const llamar = () => GET();

describe("GET /api/tienda/nombre (I-734)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeshabilitado.mockResolvedValue(false);
    mockGetStoreId.mockResolvedValue({ userId: "user-worker", storeId: STORE_ID });
    mockSingle.mockResolvedValue({ data: { name: "PetShop La Huella", rut: "76123456-7", umbral_identificacion_comprador: 5363275 }, error: null });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });
  });

  // Desde el pago mixto (I-830) también expone el umbral de 135 UF, que no es
  // sensible; nada más (ni tokens ni licencia: SEC-07).
  it("I-734/I-744: cualquier usuario de la tienda (ej. storeWorker) recibe SOLO nombre, RUT y umbral 135 UF, de SU tienda", async () => {
    const res = await llamar();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "PetShop La Huella", rut: "76123456-7", umbral_identificacion_comprador: 5363275 });
    expect(mockFrom).toHaveBeenCalledWith("stores");
    expect(mockSelect).toHaveBeenCalledWith("name, rut, umbral_identificacion_comprador");
    expect(mockEq).toHaveBeenCalledWith("id", STORE_ID);
  });

  it("I-744: tienda sin RUT → rut null (nunca undefined)", async () => {
    mockSingle.mockResolvedValue({ data: { name: "PetShop La Huella", rut: null }, error: null });
    expect(await (await llamar()).json()).toEqual({ name: "PetShop La Huella", rut: null, umbral_identificacion_comprador: null });
  });

  it("I-830: sin umbral configurado → umbral_identificacion_comprador null (el POS no avisa)", async () => {
    mockSingle.mockResolvedValue({ data: { name: "PetShop", rut: "1-9", umbral_identificacion_comprador: null }, error: null });
    expect((await (await llamar()).json()).umbral_identificacion_comprador).toBeNull();
  });

  it("I-734: sin sesión → 401 sin consultar", async () => {
    mockGetStoreId.mockResolvedValue(null);
    expect((await llamar()).status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("I-734: usuario deshabilitado → 403 sin consultar", async () => {
    mockDeshabilitado.mockResolvedValue(true);
    expect((await llamar()).status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("I-734: error de BD → 500 genérico", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await llamar();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error interno del servidor" });
  });
});
