import { GET, POST } from "@/app/api/clientes/route";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");
jest.mock("@/lib/validation");

import * as authModule from "@/lib/auth";
import * as supabaseModule from "@/lib/supabase";
import * as validationModule from "@/lib/validation";

describe("GET /api/clientes", () => {
  const mockStoreId = "store-1";

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId });
  });

  it("búsqueda por RUT retorna cliente único", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: jest.fn((resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: "cli-1",
              store_id: mockStoreId,
              nombre: "Juan Pérez",
              rut: "12345678-K",
              email: "juan@example.com",
              telefono: "98765432",
            },
          ],
          error: null,
        })
      ),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/clientes?rut=12345678-K");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.nombre).toBe("Juan Pérez");
  });

  it("búsqueda por RUT retorna null si no existe", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: jest.fn((resolve: (v: unknown) => void) =>
        resolve({
          data: [],
          error: null,
        })
      ),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/clientes?rut=99999999-9");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toBeNull();
  });

  it("listado sin búsqueda retorna todos con paginación", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({
        data: [
          {
            id: "cli-1",
            store_id: mockStoreId,
            nombre: "Juan Pérez",
            rut: "12345678-K",
            email: "juan@example.com",
            telefono: "98765432",
          },
          {
            id: "cli-2",
            store_id: mockStoreId,
            nombre: "María García",
            rut: "87654321-9",
            email: "maria@example.com",
            telefono: "87654321",
          },
        ],
        error: null,
        count: 2,
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/clientes");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data).toHaveLength(2);
    expect(data.count).toBe(2);
  });

  it("búsqueda en nombre o RUT filtra resultados", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({
        data: [
          {
            id: "cli-1",
            store_id: mockStoreId,
            nombre: "Juan Pérez",
            rut: "12345678-K",
            email: "juan@example.com",
            telefono: "98765432",
          },
        ],
        error: null,
        count: 1,
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/clientes?search=Juan");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(chain.or).toHaveBeenCalled();
    expect(data.data).toHaveLength(1);
  });

  it("sanitiza búsqueda para evitar inyección", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/clientes?search=test(drop)%extra");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(chain.or).toHaveBeenCalled();
    const callArgs = (chain.or as jest.Mock).mock.calls[0][0];
    expect(callArgs).toContain("testdropextra");
    expect(callArgs).not.toContain("(drop)");
  });

  it("respeta offset y limit para paginación", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({
        data: [],
        error: null,
        count: 100,
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/clientes?offset=50");
    const res = await GET(req);

    expect(chain.range).toHaveBeenCalledWith(50, 99);
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/clientes");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it("retorna 500 si hay error en Supabase", async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "Database error" },
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/clientes");
    const res = await GET(req);

    expect(res.status).toBe(500);
  });
});

describe("POST /api/clientes", () => {
  const mockStoreId = "store-1";

  beforeEach(() => {
    jest.clearAllMocks();
    (authModule.getStoreId as jest.Mock).mockResolvedValue({ storeId: mockStoreId });
    (validationModule.validateRUT as jest.Mock).mockReturnValue(true);
    (validationModule.formatRUT as jest.Mock).mockImplementation((rut) => rut);
  });

  it("crea cliente exitosamente", async () => {
    const clienteChain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: "cli-new",
          store_id: mockStoreId,
          rut: "12345678-K",
          nombre: "Nuevo Cliente",
          email: "nuevo@example.com",
          telefono: "98765432",
        },
        error: null,
      }),
    };

    const fidChain = {
      insert: jest.fn().mockResolvedValue({ error: null }),
    };

    let callCount = 0;
    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn((table: string) => {
        callCount++;
        if (table === "clientes") return clienteChain;
        if (table === "fidelizacion") return fidChain;
      }),
    });

    const req = new NextRequest("http://localhost/api/clientes", {
      method: "POST",
      body: JSON.stringify({
        rut: "12345678-K",
        nombre: "Nuevo Cliente",
        email: "nuevo@example.com",
        telefono: "98765432",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.nombre).toBe("Nuevo Cliente");
  });

  it("rechaza RUT inválido", async () => {
    (validationModule.validateRUT as jest.Mock).mockReturnValue(false);

    const req = new NextRequest("http://localhost/api/clientes", {
      method: "POST",
      body: JSON.stringify({
        rut: "invalid-rut",
        nombre: "Test",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("RUT inválido");
  });

  it("rechaza nombre corto", async () => {
    const req = new NextRequest("http://localhost/api/clientes", {
      method: "POST",
      body: JSON.stringify({
        rut: "12345678-K",
        nombre: "ab",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("al menos 3 caracteres");
  });

  it("retorna 409 si RUT duplicado", async () => {
    const chain = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { code: "23505", message: "duplicate key" },
      }),
    };

    (supabaseModule.createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const req = new NextRequest("http://localhost/api/clientes", {
      method: "POST",
      body: JSON.stringify({
        rut: "12345678-K",
        nombre: "Duplicado",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toContain("Ya existe");
  });

  it("retorna 401 sin autenticación", async () => {
    (authModule.getStoreId as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/clientes", {
      method: "POST",
      body: JSON.stringify({
        rut: "12345678-K",
        nombre: "Test",
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
  });
});
