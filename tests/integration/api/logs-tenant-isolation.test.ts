/**
 * SEC-16, SEC-17: aislamiento por tienda de los endpoints de logs
 * (docs/informe_security.md, hallazgos 3 y 4). admin-check real: el rol y la
 * tienda salen de los claims de Clerk mockeados.
 */
import { NextRequest } from "next/server";

jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: jest.fn((cb: () => void) => cb()),
}));

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const USER_ID = "user_admin";

const mockAuth = jest.fn();
const mockFrom = jest.fn();

jest.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom })),
}));

function claims(publicMetadata: Record<string, unknown>) {
  mockAuth.mockResolvedValue({ userId: USER_ID, sessionClaims: { sub: USER_ID, publicMetadata } });
}

// Cadena de update de error_logs; `fila` es lo que devuelve maybeSingle.
function updateChain(fila: unknown) {
  const c: Record<string, jest.Mock> = {
    update: jest.fn(),
    eq: jest.fn(),
    select: jest.fn(),
    maybeSingle: jest.fn().mockResolvedValue({ data: fila, error: null }),
  };
  ["update", "eq", "select"].forEach((k) => c[k].mockReturnValue(c));
  return c;
}

async function resolver(id = "err-1") {
  const { PATCH } = await import("@/app/api/error-logs/[id]/resolve/route");
  return PATCH(new NextRequest(`http://localhost/api/error-logs/${id}/resolve`, { method: "PATCH" }), {
    params: Promise.resolve({ id }),
  });
}

describe("SEC-16: PATCH /api/error-logs/[id]/resolve solo resuelve logs de la tienda propia", () => {
  beforeEach(() => jest.clearAllMocks());

  it("storeAdmin filtra por su store_id", async () => {
    claims({ storeAdmin: true, storeId: STORE_ID });
    const chain = updateChain({ id: "err-1", resolved: true });
    mockFrom.mockReturnValue(chain);

    const res = await resolver();

    expect(res.status).toBe(200);
    expect(chain.eq).toHaveBeenCalledWith("id", "err-1");
    expect(chain.eq).toHaveBeenCalledWith("store_id", STORE_ID);
  });

  it("log de otra tienda (sin fila en la propia) → 404 sin datos ajenos", async () => {
    claims({ storeAdmin: true, storeId: STORE_ID });
    mockFrom.mockReturnValue(updateChain(null));

    const res = await resolver("err-otra-tienda");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).not.toHaveProperty("data");
  });

  it("storeAdmin sin storeId → 403 sin tocar la BD", async () => {
    claims({ storeAdmin: true });

    const res = await resolver();

    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("systemAdmin (confirmado en BD) resuelve sin filtro de tienda", async () => {
    claims({ systemAdmin: true });
    const chain = updateChain({ id: "err-1", resolved: true });
    mockFrom.mockImplementation((tabla: string) =>
      tabla === "clerk_users"
        ? {
            select: () => ({
              eq: () => ({ single: () => Promise.resolve({ data: { system_admin: true }, error: null }) }),
            }),
          }
        : chain,
    );

    const res = await resolver();

    expect(res.status).toBe(200);
    expect(chain.eq).not.toHaveBeenCalledWith("store_id", expect.anything());
  });
});

describe("SEC-17: endpoints de logs niegan a un storeAdmin sin storeId (antes devolvían todas las tiendas)", () => {
  beforeEach(() => jest.clearAllMocks());

  const rutas: [string, () => Promise<{ GET: (req: NextRequest) => Promise<Response> }>][] = [
    ["/api/audit-logs", () => import("@/app/api/audit-logs/route")],
    ["/api/audit-logs/summary", () => import("@/app/api/audit-logs/summary/route")],
    ["/api/error-logs", () => import("@/app/api/error-logs/route")],
    ["/api/user-sessions", () => import("@/app/api/user-sessions/route")],
  ];

  it.each(rutas)("GET %s → 403 sin consultar", async (path, cargar) => {
    claims({ storeAdmin: true });
    const { GET } = await cargar();

    const res = await GET(new NextRequest(`http://localhost${path}`));

    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
