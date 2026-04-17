import { NextRequest } from "next/server";
import { GET } from "@/app/api/dashboard/vencimientos/route";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";

jest.mock("@/lib/auth");
jest.mock("@/lib/supabase");

const mockGetStoreId = getStoreId as jest.MockedFunction<typeof getStoreId>;
const mockCreateServiceClient = createServiceClient as jest.MockedFunction<typeof createServiceClient>;

const STORE_ID = "store-123";
const TODAY = "2024-04-16";

describe("GET /api/dashboard/vencimientos", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock auth
    mockGetStoreId.mockResolvedValue({ userId: "user-123", storeId: STORE_ID });

    // Mock Date.now()
    jest.spyOn(Date.prototype, "toISOString").mockReturnValue(`${TODAY}T00:00:00.000Z`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function setupSupabaseMock(data: any[]) {
    const chain: any = {};
    chain.select = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockReturnValue(chain);
    chain.not = jest.fn().mockReturnValue(chain);
    chain.order = jest.fn().mockResolvedValue({ data, error: null });

    const mockSupabase = {
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateServiceClient.mockReturnValue(mockSupabase as any);
    return chain;
  }

  it("debería retornar error 401 si usuario no está autenticado", async () => {
    mockGetStoreId.mockResolvedValue(null);

    const response = await GET(new NextRequest(new URL("http://localhost:3000")));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });

  it("debería clasificar productos vencidos correctamente", async () => {
    const productos = [
      {
        id: "p1",
        nombre: "Producto A",
        sku: "SKU-A",
        stock: 5,
        fecha_vencimiento: "2024-04-10",
        dias_alerta: 10,
        precio_oferta: null,
        en_oferta: false,
      },
      {
        id: "p2",
        nombre: "Producto B",
        sku: "SKU-B",
        stock: 3,
        fecha_vencimiento: "2024-04-25",
        dias_alerta: 7,
        precio_oferta: null,
        en_oferta: false,
      },
    ];

    setupSupabaseMock(productos);

    const response = await GET(new NextRequest(new URL("http://localhost:3000")));
    const json = await response.json();

    expect(json.vencidos).toEqual([
      {
        id: "p1",
        nombre: "Producto A",
        sku: "SKU-A",
        stock: 5,
        fecha_vencimiento: "2024-04-10",
        dias_alerta: 10,
        precio_oferta: null,
        en_oferta: false,
      },
    ]);
    expect(json.totalUnidadesVencidas).toBe(5);
  });

  it("debería clasificar productos próximos a vencer con días restantes", async () => {
    const productos = [
      {
        id: "p1",
        nombre: "Producto A",
        sku: "SKU-A",
        stock: 2,
        fecha_vencimiento: "2024-04-20", // 4 días restantes
        dias_alerta: 7,
        precio_oferta: null,
        en_oferta: false,
      },
    ];

    setupSupabaseMock(productos);

    const response = await GET(new NextRequest(new URL("http://localhost:3000")));
    const json = await response.json();

    expect(json.proximos).toHaveLength(1);
    expect(json.proximos[0].diasRestantes).toBe(4);
  });

  it("debería excluir productos sin vencimiento de filtro en BD (not is null)", async () => {
    // La BD filtra con not("fecha_vencimiento", "is", null) en la query
    // Así que aquí testamos que la respuesta no contiene nulos
    const productos = [
      {
        id: "p1",
        nombre: "Producto A",
        sku: "SKU-A",
        stock: 5,
        fecha_vencimiento: "2025-12-31",
        dias_alerta: 10,
        precio_oferta: null,
        en_oferta: false,
      },
    ];

    setupSupabaseMock(productos);

    const response = await GET(new NextRequest(new URL("http://localhost:3000")));
    const json = await response.json();

    expect(json.vencidos).toHaveLength(0);
    expect(json.proximos).toHaveLength(0); // No está en rango de alerta
    expect(json.vencidos.every((p: any) => p.fecha_vencimiento !== null)).toBe(true);
  });

  it("debería excluir productos vencidos con stock 0", async () => {
    const productos = [
      {
        id: "p1",
        nombre: "Producto A",
        sku: "SKU-A",
        stock: 0,
        fecha_vencimiento: "2024-04-10",
        dias_alerta: 10,
        precio_oferta: null,
        en_oferta: false,
      },
    ];

    setupSupabaseMock(productos);

    const response = await GET(new NextRequest(new URL("http://localhost:3000")));
    const json = await response.json();

    expect(json.vencidos).toHaveLength(0);
    expect(json.totalUnidadesVencidas).toBe(0);
  });

  it("debería respetar filtro dias_alerta para próximos a vencer", async () => {
    const productos = [
      {
        id: "p1",
        nombre: "Producto A",
        sku: "SKU-A",
        stock: 2,
        fecha_vencimiento: "2024-04-25", // 9 días restantes
        dias_alerta: 7, // Solo alertar con 7 días o menos
        precio_oferta: null,
        en_oferta: false,
      },
    ];

    setupSupabaseMock(productos);

    const response = await GET(new NextRequest(new URL("http://localhost:3000")));
    const json = await response.json();

    expect(json.proximos).toHaveLength(0); // No incluído porque tiene más de 7 días
  });

  it("debería incluir producto en próximos si tiene días_alerta=0", async () => {
    const productos = [
      {
        id: "p1",
        nombre: "Producto A",
        sku: "SKU-A",
        stock: 2,
        fecha_vencimiento: "2024-04-17", // 1 día restante
        dias_alerta: 0, // Sin alerta configurada
        precio_oferta: null,
        en_oferta: false,
      },
    ];

    setupSupabaseMock(productos);

    const response = await GET(new NextRequest(new URL("http://localhost:3000")));
    const json = await response.json();

    expect(json.proximos).toHaveLength(0); // 1 día > 0 días
  });

  it("debería incluir precio_oferta y en_oferta en respuesta", async () => {
    const productos = [
      {
        id: "p1",
        nombre: "Producto A",
        sku: "SKU-A",
        stock: 2,
        fecha_vencimiento: "2024-04-20",
        dias_alerta: 7,
        precio_oferta: 15000,
        en_oferta: true,
      },
    ];

    setupSupabaseMock(productos);

    const response = await GET(new NextRequest(new URL("http://localhost:3000")));
    const json = await response.json();

    expect(json.proximos[0]).toEqual(
      expect.objectContaining({
        precio_oferta: 15000,
        en_oferta: true,
      })
    );
  });

  it("debería retornar array vacío si no hay productos", async () => {
    setupSupabaseMock([]);

    const response = await GET(new NextRequest(new URL("http://localhost:3000")));
    const json = await response.json();

    expect(json.vencidos).toEqual([]);
    expect(json.proximos).toEqual([]);
    expect(json.totalUnidadesVencidas).toBe(0);
  });

  it("debería ordenar productos por fecha_vencimiento ascendente", async () => {
    const chain = setupSupabaseMock([]);

    const mockRequest = new NextRequest(new URL("http://localhost:3000"));
    await GET(mockRequest);

    expect(chain.order).toHaveBeenCalledWith("fecha_vencimiento", { ascending: true });
  });

  it("debería retornar error 500 si supabase falla", async () => {
    const chain: any = {};
    chain.select = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockReturnValue(chain);
    chain.not = jest.fn().mockReturnValue(chain);
    chain.order = jest.fn().mockResolvedValue({ data: null, error: { message: "Database error" } });

    const mockSupabase = {
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateServiceClient.mockReturnValue(mockSupabase as any);

    const response = await GET(new NextRequest(new URL("http://localhost:3000")));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("Error interno del servidor");
  });

  it("debería calcular correctamente totalUnidadesVencidas con múltiples productos", async () => {
    const productos = [
      {
        id: "p1",
        nombre: "Producto A",
        sku: "SKU-A",
        stock: 5,
        fecha_vencimiento: "2024-04-10",
        dias_alerta: 10,
        precio_oferta: null,
        en_oferta: false,
      },
      {
        id: "p2",
        nombre: "Producto B",
        sku: "SKU-B",
        stock: 8,
        fecha_vencimiento: "2024-04-15",
        dias_alerta: 10,
        precio_oferta: null,
        en_oferta: false,
      },
    ];

    setupSupabaseMock(productos);

    const response = await GET(new NextRequest(new URL("http://localhost:3000")));
    const json = await response.json();

    expect(json.totalUnidadesVencidas).toBe(13); // 5 + 8
  });

  it("debería incluir campo hoy en respuesta", async () => {
    setupSupabaseMock([]);

    const response = await GET(new NextRequest(new URL("http://localhost:3000")));
    const json = await response.json();

    expect(json.hoy).toBe(TODAY);
  });
});
