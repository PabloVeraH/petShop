/**
 * Tests I-722 a I-729: /api/canales/instagram/** (posts, post por id, upload).
 *
 * Reemplaza los 8 placeholders `expect(true).toBe(true)` que había aquí
 * ("verificado vía build"): no ejecutaban ninguna ruta. La autorización
 * (401 sin sesión, 403 storeWorker/deshabilitado — Fase 5, 5.1) está en
 * canales-fase5.test.ts; aquí se prueba el funcionamiento y el aislamiento de
 * tenant de cada ruta, con la sesión de un storeAdmin.
 *
 * Supabase se simula con tests/helpers/fake-supabase (una consulta por from())
 * más un Storage simulado para el upload.
 */
import { NextRequest } from "next/server";
import { crearFakeSupabase, tiene, argsDe } from "../../helpers/fake-supabase";

// Fase 5 (5.1): /api/canales/** rechaza usuarios deshabilitados; por defecto habilitado.
const mockDeshabilitado = jest.fn().mockResolvedValue(false);
jest.mock("@/lib/usuario-habilitado", () => ({ usuarioDeshabilitado: (...a: unknown[]) => mockDeshabilitado(...a) }));
jest.mock("@/lib/audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  getRequestMetadata: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
  withErrorLogging: (h: unknown) => h,
}));
let fakeActual: ReturnType<typeof crearFakeSupabase>;
const mockUpload = jest.fn();
const mockGetPublicUrl = jest.fn();
const mockStorageFrom = jest.fn(() => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl }));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({ ...fakeActual.client, storage: { from: (b: string) => mockStorageFrom(b) } }),
}));
const mockGetStoreId = jest.fn();
jest.mock("@/lib/auth", () => ({ getStoreId: () => mockGetStoreId() }));
const mockAuth = jest.fn();
jest.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));

import { GET as LISTAR, POST as CREAR } from "@/app/api/canales/instagram/posts/route";
import { PATCH as EDITAR, DELETE as BORRAR } from "@/app/api/canales/instagram/posts/[id]/route";
import { POST as SUBIR } from "@/app/api/canales/instagram/upload/route";

const STORE = "123e4567-e89b-12d3-a456-426614174000";
const OTRA = "123e4567-e89b-12d3-a456-4266141740ff";
const POST_ID = "623e4567-e89b-12d3-a456-426614174001";

let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockDeshabilitado.mockResolvedValue(false);
  mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE });
  mockAuth.mockResolvedValue({ sessionClaims: { sub: "u1", publicMetadata: { storeId: STORE, storeAdmin: true } } });
  errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  } as never);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const insertDe = (tabla: string) =>
  argsDe(fakeActual.consultas.find((c) => c.tabla === tabla && tiene(c.ops, "insert"))!.ops, "insert")?.[0];

describe("GET /api/canales/instagram/posts", () => {
  it("I-722: lista solo los posts de la tienda de la sesión, filtra por status si viene; error de BD → 500", async () => {
    fakeActual = crearFakeSupabase(() => ({ data: [{ id: POST_ID }] }));
    const res = await LISTAR(req("/api/canales/instagram/posts?status=scheduled"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: POST_ID }]);
    const ops = fakeActual.consultas[0].ops;
    expect(tiene(ops, "eq", "store_id", STORE) && tiene(ops, "eq", "status", "scheduled")).toBe(true);

    fakeActual = crearFakeSupabase(() => ({ data: null }));
    await LISTAR(req("/api/canales/instagram/posts"));
    expect(fakeActual.consultas[0].ops.some((o) => o.m === "eq" && o.a[0] === "status")).toBe(false);

    fakeActual = crearFakeSupabase(() => ({ error: { code: "57014" } }));
    expect((await LISTAR(req("/api/canales/instagram/posts"))).status).toBe(500);
  });
});

describe("POST /api/canales/instagram/posts", () => {
  it("I-723: crea con store_id de la sesión (un store_id en el body se ignora); sin fecha → published, con fecha → scheduled", async () => {
    fakeActual = crearFakeSupabase(() => ({ data: { id: POST_ID } }));
    const res = await CREAR(req("/x", "POST", { content_type: "post", caption: "Hola", store_id: OTRA }));
    expect(res.status).toBe(201);
    const fila = insertDe("instagram_posts") as Record<string, unknown>;
    expect(fila).toMatchObject({ store_id: STORE, content_type: "post", caption: "Hola", status: "published", scheduled_for: null });
    expect(fila.published_at).toEqual(expect.any(String));

    fakeActual = crearFakeSupabase(() => ({ data: { id: POST_ID } }));
    await CREAR(req("/x", "POST", { content_type: "story", scheduled_for: "2026-10-01T15:00:00Z" }));
    expect(insertDe("instagram_posts")).toMatchObject({ status: "scheduled", published_at: null, scheduled_for: "2026-10-01T15:00:00Z" });
  });

  it("I-724: carrusel inserta las imágenes en orden; falla del post o de las imágenes → 500; payload inválido → 400 sin tocar la BD", async () => {
    fakeActual = crearFakeSupabase(() => ({ data: { id: POST_ID } }));
    const urls = ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"];
    expect((await CREAR(req("/x", "POST", { content_type: "carousel", media_urls: urls }))).status).toBe(201);
    expect(insertDe("instagram_post_media")).toEqual([
      { post_id: POST_ID, media_url: urls[0], media_type: "image", sort_order: 0 },
      { post_id: POST_ID, media_url: urls[1], media_type: "image", sort_order: 1 },
    ]);

    fakeActual = crearFakeSupabase((tabla) => (tabla === "instagram_post_media" ? { error: { code: "23503" } } : { data: { id: POST_ID } }));
    expect((await CREAR(req("/x", "POST", { content_type: "carousel", media_urls: urls }))).status).toBe(500);

    fakeActual = crearFakeSupabase(() => ({ error: { code: "23514" } }));
    expect((await CREAR(req("/x", "POST", { content_type: "post" }))).status).toBe(500);

    fakeActual = crearFakeSupabase(() => ({ data: {} }));
    for (const malo of [{ content_type: "reel" }, { content_type: "post", image_url: "no-es-url" }, { content_type: "post", caption: "x".repeat(2201) }]) {
      expect((await CREAR(req("/x", "POST", malo))).status).toBe(400);
    }
    expect(fakeActual.consultas).toHaveLength(0);
  });
});

describe("PATCH / DELETE /api/canales/instagram/posts/[id]", () => {
  const montar = (existente: { status: string } | null, errorEscritura: unknown = null) => {
    fakeActual = crearFakeSupabase((_t, ops) => {
      if (tiene(ops, "update") || tiene(ops, "delete")) return errorEscritura ? { error: errorEscritura } : { data: { id: POST_ID, caption: "Nuevo" } };
      return existente ? { data: existente } : { data: null, error: { code: "PGRST116" } };
    });
  };

  it("I-725: PATCH edita un post programado de la tienda (solo los campos enviados, por store_id)", async () => {
    montar({ status: "scheduled" });
    const res = await EDITAR(req("/x", "PATCH", { caption: "Nuevo" }), params(POST_ID));
    expect(res.status).toBe(200);
    const upd = fakeActual.consultas.find((c) => tiene(c.ops, "update"))!;
    expect(argsDe(upd.ops, "update")?.[0]).toEqual({ caption: "Nuevo", updated_at: expect.any(String) });
    expect(tiene(upd.ops, "eq", "store_id", STORE) && tiene(upd.ops, "eq", "id", POST_ID)).toBe(true);
    expect(tiene(fakeActual.consultas[0].ops, "eq", "store_id", STORE)).toBe(true);
  });

  it("I-726: PATCH/DELETE de un post de otra tienda o inexistente → 404 sin escribir; publicado → 409; payload inválido → 400", async () => {
    for (const accion of [
      () => EDITAR(req("/x", "PATCH", { caption: "x" }), params(POST_ID)),
      () => BORRAR(req("/x", "DELETE"), params(POST_ID)),
    ]) {
      montar(null);
      expect((await accion()).status).toBe(404);
      expect(fakeActual.consultas.some((c) => tiene(c.ops, "update") || tiene(c.ops, "delete"))).toBe(false);
      montar({ status: "published" });
      expect((await accion()).status).toBe(409);
      expect(fakeActual.consultas.some((c) => tiene(c.ops, "update") || tiene(c.ops, "delete"))).toBe(false);
    }
    montar({ status: "scheduled" });
    expect((await EDITAR(req("/x", "PATCH", { scheduled_for: "mañana" }), params(POST_ID))).status).toBe(400);
  });

  it("I-727: DELETE borra un post no publicado por id + store_id; error de BD al editar o borrar → 500", async () => {
    montar({ status: "draft" });
    const res = await BORRAR(req("/x", "DELETE"), params(POST_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "deleted" });
    const del = fakeActual.consultas.find((c) => tiene(c.ops, "delete"))!;
    expect(tiene(del.ops, "eq", "store_id", STORE) && tiene(del.ops, "eq", "id", POST_ID)).toBe(true);

    montar({ status: "draft" }, { code: "40001" });
    expect((await BORRAR(req("/x", "DELETE"), params(POST_ID))).status).toBe(500);
    montar({ status: "draft" }, { code: "40001" });
    expect((await EDITAR(req("/x", "PATCH", { caption: "x" }), params(POST_ID))).status).toBe(500);
  });
});

describe("POST /api/canales/instagram/upload", () => {
  const subir = (file?: File) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    return SUBIR(new NextRequest("http://localhost/api/canales/instagram/upload", { method: "POST", body: fd } as never));
  };
  const imagen = (tipo = "image/png", bytes = 10, nombre = "foto.png") => new File([new Uint8Array(bytes)], nombre, { type: tipo });

  it("I-728: sube al bucket instagram-media bajo la carpeta de la tienda de la sesión y devuelve la URL pública", async () => {
    fakeActual = crearFakeSupabase(() => ({}));
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: "https://cdn.example/x.png" } });
    const res = await subir(imagen());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ url: "https://cdn.example/x.png" });
    expect(mockStorageFrom).toHaveBeenCalledWith("instagram-media");
    const [ruta, , opciones] = mockUpload.mock.calls[0];
    expect(ruta).toMatch(new RegExp(`^${STORE}/\\d+\\.png$`));
    expect(opciones).toEqual({ contentType: "image/png", upsert: false });
  });

  it("I-729: sin archivo, tipo no permitido o > 10 MB → 400 sin subir; error del Storage → 500", async () => {
    fakeActual = crearFakeSupabase(() => ({}));
    expect((await subir()).status).toBe(400);
    expect((await subir(imagen("application/pdf", 10, "doc.pdf"))).status).toBe(400);
    expect((await subir(imagen("image/svg+xml", 10, "x.svg"))).status).toBe(400);
    expect((await subir(imagen("image/jpeg", 10 * 1024 * 1024 + 1, "grande.jpg"))).status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();

    mockUpload.mockResolvedValue({ error: { message: "bucket lleno" } });
    const res = await subir(imagen());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error subiendo imagen" });
  });
});
