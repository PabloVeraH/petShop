/**
 * Tests para POST/DELETE /api/productos/imagenes
 */
import { NextRequest } from "next/server";

jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return {
    ...actual,
    after: jest.fn((cb: () => void) => cb()),
  };
});

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const PRODUCTO_ID = "323e4567-e89b-12d3-a456-426614174050";

const mockGetStoreId = jest.fn();
const mockOptimizar = jest.fn();
const mockSubir = jest.fn();
const mockEliminar = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/r2-storage", () => ({
  optimizarImagenProducto: mockOptimizar,
  subirImagenProducto: mockSubir,
  eliminarImagenProducto: mockEliminar,
}));

function makePostRequest(file?: File, productoId: string | null = PRODUCTO_ID) {
  const formData = new FormData();
  if (file) formData.append("file", file);
  if (productoId !== null) formData.append("productoId", productoId);
  return new NextRequest("http://localhost/api/productos/imagenes", {
    method: "POST",
    body: formData,
  });
}

function makeDeleteRequest(body: object) {
  return new NextRequest("http://localhost/api/productos/imagenes", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeJpegFile(sizeBytes = 1024): File {
  const buffer = new Uint8Array(sizeBytes).fill(0xFF);
  return new File([buffer], "test.jpg", { type: "image/jpeg" });
}

describe("POST /api/productos/imagenes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockOptimizar.mockResolvedValue(Buffer.from("optimized"));
    mockSubir.mockResolvedValue(`https://pub-test.r2.dev/productos/${STORE_ID}/img.webp`);
  });

  it("IMG-01: retorna 401 sin sesión", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/productos/imagenes/route");
    const res = await POST(makePostRequest(makeJpegFile()));
    expect(res.status).toBe(401);
  });

  it("IMG-02: retorna 400 sin archivo", async () => {
    const { POST } = await import("@/app/api/productos/imagenes/route");
    const res = await POST(makePostRequest());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/requerido/i);
  });

  it("IMG-03: retorna 400 con tipo no permitido", async () => {
    const pdf = new File([new Uint8Array(100)], "doc.pdf", { type: "application/pdf" });
    const { POST } = await import("@/app/api/productos/imagenes/route");
    const res = await POST(makePostRequest(pdf));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/no permitido/i);
  });

  it("IMG-04: retorna 400 con archivo excediendo 8MB", async () => {
    const bigFile = makeJpegFile(9 * 1024 * 1024); // 9 MB
    const { POST } = await import("@/app/api/productos/imagenes/route");
    const res = await POST(makePostRequest(bigFile));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/tamaño máximo/i);
  });

  it("IMG-05: retorna 201 con URL bajo R2_PUBLIC_URL en éxito", async () => {
    const { POST } = await import("@/app/api/productos/imagenes/route");
    const res = await POST(makePostRequest(makeJpegFile()));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.url).toContain("r2.dev");
    expect(data.url).toContain(`productos/${STORE_ID}/`);
    expect(mockOptimizar).toHaveBeenCalled();
    expect(mockSubir).toHaveBeenCalledWith(STORE_ID, PRODUCTO_ID, expect.any(Buffer));
  });

  it("IMG-06: retorna 400 si sharp falla (archivo corrupto)", async () => {
    mockOptimizar.mockRejectedValue(new Error("sharp decode error"));
    const { POST } = await import("@/app/api/productos/imagenes/route");
    const res = await POST(makePostRequest(makeJpegFile()));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/no se pudo procesar/i);
    expect(mockSubir).not.toHaveBeenCalled();
  });

  // IMG-11/12 — regresión: la key en R2 ahora se organiza por producto
  // (productos/{storeId}/{productoId}/...), generado en el cliente antes de
  // que el producto exista (ver docs/product-images.md). Sin un productoId
  // válido no hay dónde guardar la foto.
  it("IMG-11: retorna 400 sin productoId", async () => {
    const { POST } = await import("@/app/api/productos/imagenes/route");
    const res = await POST(makePostRequest(makeJpegFile(), null));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/productoId/i);
    expect(mockSubir).not.toHaveBeenCalled();
  });

  it("IMG-12: retorna 400 con productoId que no es un UUID válido", async () => {
    const { POST } = await import("@/app/api/productos/imagenes/route");
    const res = await POST(makePostRequest(makeJpegFile(), "no-es-un-uuid"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/productoId/i);
    expect(mockSubir).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/productos/imagenes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
    mockEliminar.mockResolvedValue(undefined);
  });

  it("IMG-07: retorna 401 sin sesión", async () => {
    mockGetStoreId.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/productos/imagenes/route");
    const res = await DELETE(makeDeleteRequest({ url: "https://pub-test.r2.dev/productos/123/img.webp" }));
    expect(res.status).toBe(401);
  });

  it("IMG-08: retorna 400 sin URL", async () => {
    const { DELETE } = await import("@/app/api/productos/imagenes/route");
    const res = await DELETE(makeDeleteRequest({}));
    expect(res.status).toBe(400);
  });

  it("IMG-09: retorna 403 si la URL no pertenece al storeId", async () => {
    mockEliminar.mockRejectedValue(new Error("URL de imagen no pertenece a esta tienda"));
    const { DELETE } = await import("@/app/api/productos/imagenes/route");
    const res = await DELETE(makeDeleteRequest({ url: "https://pub-test.r2.dev/productos/otro-store/img.webp" }));
    expect(res.status).toBe(403);
  });

  it("IMG-10: retorna 204 en éxito", async () => {
    const { DELETE } = await import("@/app/api/productos/imagenes/route");
    const url = `https://pub-test.r2.dev/productos/${STORE_ID}/img.webp`;
    const res = await DELETE(makeDeleteRequest({ url }));
    expect(res.status).toBe(204);
    expect(mockEliminar).toHaveBeenCalledWith(url, STORE_ID);
  });
});
