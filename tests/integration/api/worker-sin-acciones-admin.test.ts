/**
 * SEC-18: el storeWorker no puede crear/eliminar asientos manuales, pagar
 * cuentas por pagar, crear productos ni gestionar proveedores (incluida la
 * asociación proveedor-producto). Antes estos endpoints solo exigían sesión
 * con tienda (getStoreId) y el worker podía llamarlos directo a la API: el
 * middleware le niega las páginas, no /api (docs/informe_security.md, hallazgo 2).
 * admin-check real; Clerk, getStoreId y Supabase mockeados.
 */
import { NextRequest } from "next/server";

jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: jest.fn((cb: () => void) => cb()),
}));

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const OTRA_TIENDA = "123e4567-e89b-12d3-a456-426614174999";
const ID = "123e4567-e89b-12d3-a456-426614174111";

const mockAuth = jest.fn();
const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();

jest.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));
jest.mock("@/lib/auth", () => ({ getStoreId: () => mockGetStoreId() }));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({ from: mockFrom, rpc: mockFrom }),
}));

function sesion(publicMetadata: Record<string, unknown>) {
  mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  mockAuth.mockResolvedValue({ userId: "u1", sessionClaims: { sub: "u1", publicMetadata } });
}

function req(url: string, method: string) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: method === "DELETE" ? undefined : JSON.stringify({}),
    headers: { "Content-Type": "application/json" },
  });
}

type Llamada = () => Promise<Response>;
const params = { params: Promise.resolve({ id: ID }) };

const endpoints: [string, Llamada][] = [
  ["POST /api/contabilidad/asientos", async () =>
    (await import("@/app/api/contabilidad/asientos/route")).POST(req("/api/contabilidad/asientos", "POST"))],
  ["DELETE /api/contabilidad/asientos/[id]", async () =>
    (await import("@/app/api/contabilidad/asientos/[id]/route")).DELETE(req(`/api/contabilidad/asientos/${ID}`, "DELETE"), params)],
  ["PATCH /api/cuentas-pagar", async () =>
    (await import("@/app/api/cuentas-pagar/route")).PATCH(req(`/api/cuentas-pagar?id=${ID}`, "PATCH"))],
  ["POST /api/productos", async () =>
    (await import("@/app/api/productos/route")).POST(req("/api/productos", "POST"))],
  ["POST /api/proveedores", async () =>
    (await import("@/app/api/proveedores/route")).POST(req("/api/proveedores", "POST"))],
  ["DELETE /api/proveedores", async () =>
    (await import("@/app/api/proveedores/route")).DELETE(req(`/api/proveedores?id=${ID}`, "DELETE"))],
  ["PATCH /api/proveedores/[id]", async () =>
    (await import("@/app/api/proveedores/[id]/route")).PATCH(req(`/api/proveedores/${ID}`, "PATCH"), params)],
  ["POST /api/proveedor-productos", async () =>
    (await import("@/app/api/proveedor-productos/route")).POST(req("/api/proveedor-productos", "POST"))],
  ["DELETE /api/proveedor-productos", async () =>
    (await import("@/app/api/proveedor-productos/route")).DELETE(req(`/api/proveedor-productos?id=${ID}`, "DELETE"))],
];

describe("SEC-18: acciones de admin negadas al storeWorker", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(endpoints)("%s — storeWorker → 403 sin tocar la BD", async (_n, llamar) => {
    sesion({ storeWorker: true, storeId: STORE_ID });
    const res = await llamar();
    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it.each(endpoints)("%s — sin rol en la metadata → 403 sin tocar la BD", async (_n, llamar) => {
    sesion({ storeId: STORE_ID });
    const res = await llamar();
    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it.each(endpoints)("%s — storeAdmin de otra tienda → 403 sin tocar la BD", async (_n, llamar) => {
    sesion({ storeAdmin: true, storeId: OTRA_TIENDA });
    const res = await llamar();
    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it.each(endpoints)("%s — storeAdmin de la tienda pasa el guard (no 401/403)", async (_n, llamar) => {
    sesion({ storeAdmin: true, storeId: STORE_ID });
    const res = await llamar();
    // El body vacío o la BD mockeada pueden dar 400/404/500; lo que se
    // prueba aquí es que la autorización no lo bloquea.
    expect([401, 403]).not.toContain(res.status);
  });
});
