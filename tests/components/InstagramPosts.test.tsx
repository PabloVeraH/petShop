/**
 * Tests IGP-01 a IGP-09: páginas de publicaciones de Instagram (dashboard,
 * programadas, historial y editor).
 *
 * IGP-04/IGP-06: REGRESIÓN — "Crear una →" y "Editar" navegaban a
 * /canales/instagram/editor, ruta que no existe (el editor vive en
 * /canales/instagram/posts/editor).
 * IGP-08: REGRESIÓN — el editor buscaba el post a editar solo entre los
 * borradores (?status=draft): uno programado abría el formulario vacío.
 * IGP-09: REGRESIÓN — "Guardar como Borrador" mandaba lo mismo que "Publicar"
 * (el post quedaba publicado); ahora manda borrador=true (ver I-741).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockPush = jest.fn();
let mockId: string | null = null;
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: () => mockId }),
}));

import InstagramDashboard from "@/app/(app)/canales/instagram/posts/page";
import ScheduledPosts from "@/app/(app)/canales/instagram/posts/scheduled/page";
import PublishedPosts from "@/app/(app)/canales/instagram/posts/published/page";
import InstagramEditor from "@/app/(app)/canales/instagram/posts/editor/page";

const fetchMock = jest.fn();
type Ruta = (url: string, init?: RequestInit) => { ok?: boolean; body: unknown } | undefined;
function rutear(fn: Ruta) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const r = fn(url, init) ?? { body: [] };
    return { ok: r.ok ?? true, json: async () => r.body };
  });
}

let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockId = null;
  global.fetch = fetchMock as unknown as typeof fetch;
  errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

describe("Instagram — dashboard", () => {
  it("IGP-01: sin Instagram activo pide configurarlo y lleva a /canales/instagram", async () => {
    rutear((u) => (u === "/api/canales/config" ? { body: [{ canal_id: "instagram", activo: false }] } : undefined));
    render(<InstagramDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Configurar ahora" }));
    expect(mockPush).toHaveBeenCalledWith("/canales/instagram");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/canales/instagram/posts");
  });

  it("IGP-02: conectado cuenta programadas y publicadas y navega a cada sección", async () => {
    rutear((u) => {
      if (u === "/api/canales/config") return { body: [{ canal_id: "instagram", activo: true }] };
      if (u === "/api/canales/instagram/posts") return { body: [{ id: "1", status: "scheduled" }, { id: "2", status: "published" }, { id: "3", status: "published" }] };
    });
    render(<InstagramDashboard />);
    expect(await screen.findByText("1 posts en cola")).toBeInTheDocument();
    expect(screen.getByText("2 publicadas")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Crear Publicación"));
    fireEvent.click(screen.getByText("Programados"));
    fireEvent.click(screen.getByText("Historial"));
    expect(mockPush.mock.calls.map((c) => c[0])).toEqual([
      "/canales/instagram/posts/editor", "/canales/instagram/posts/scheduled", "/canales/instagram/posts/published",
    ]);
  });

  it("IGP-03: si la carga falla no se queda en Cargando", async () => {
    fetchMock.mockRejectedValue(new Error("red"));
    render(<InstagramDashboard />);
    expect(await screen.findByText("Configura tu cuenta de Instagram")).toBeInTheDocument();
  });
});

describe("Instagram — programadas e historial", () => {
  it("IGP-04: programadas: lista, Editar va al editor real, Cancelar pide confirmación y hace DELETE", async () => {
    rutear((u, i) => {
      if (i?.method === "DELETE") return { body: {} };
      if (u === "/api/canales/instagram/posts?status=scheduled") {
        return { body: [{ id: "p1", content_type: "post", caption: "Oferta", image_url: "https://x/i.png", scheduled_for: "2026-10-20T15:00:00Z", status: "scheduled" }, { id: "p2", content_type: "story", scheduled_for: "2026-10-21T15:00:00Z", status: "scheduled" }] };
      }
    });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<ScheduledPosts />);
    expect(await screen.findByText("Oferta")).toBeInTheDocument();
    expect(screen.getByText("Sin caption")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]);
    expect(mockPush).toHaveBeenCalledWith("/canales/instagram/posts/editor?id=p1");

    fireEvent.click(screen.getAllByRole("button", { name: "Cancelar" })[0]);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/canales/instagram/posts/p1", expect.anything());
    fireEvent.click(screen.getAllByRole("button", { name: "Cancelar" })[0]);
    await waitFor(() => expect(screen.queryByText("Oferta")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/canales/instagram/posts/p1", { method: "DELETE" });

    fireEvent.click(screen.getByRole("button", { name: "← Volver" }));
    expect(mockPush).toHaveBeenLastCalledWith("/canales/instagram/posts");
    confirmSpy.mockRestore();
  });

  it("IGP-05: programadas vacías (o respuesta inválida) ofrecen crear una en el editor real", async () => {
    rutear(() => ({ body: { error: "x" } }));
    render(<ScheduledPosts />);
    fireEvent.click(await screen.findByRole("button", { name: "Crear una →" }));
    expect(mockPush).toHaveBeenCalledWith("/canales/instagram/posts/editor");
  });

  it("IGP-06: historial muestra hace cuánto se publicó, abre el post en Instagram; vacío ofrece crear", async () => {
    const hace = (seg: number) => new Date(Date.now() - seg * 1000).toISOString();
    rutear(() => ({ body: [
      { id: "a", content_type: "post", caption: "A", published_at: hace(10), external_post_id: "XYZ" },
      { id: "b", content_type: "post", published_at: hace(120) },
      { id: "c", content_type: "post", published_at: hace(7200) },
      { id: "d", content_type: "post", published_at: hace(200000) },
      { id: "e", content_type: "post", image_url: "https://x/e.png" },
    ] }));
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    const { unmount } = render(<PublishedPosts />);
    expect(await screen.findByText("hace unos segundos")).toBeInTheDocument();
    for (const t of ["hace 2m", "hace 2h", "hace 2d", "Publicado"]) expect(screen.getByText(t)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver en Instagram ↗" }));
    expect(openSpy).toHaveBeenCalledWith("https://instagram.com/p/XYZ", "_blank");
    openSpy.mockRestore();
    unmount();

    rutear(() => ({ body: [] }));
    render(<PublishedPosts />);
    fireEvent.click(await screen.findByRole("button", { name: "Crear una →" }));
    expect(mockPush).toHaveBeenCalledWith("/canales/instagram/posts/editor");
  });
});

describe("Instagram — editor", () => {
  const PRODUCTOS = [{ id: "pr1", nombre: "Alimento", precio: 9990 }];

  it("IGP-07: crear: sube la imagen, etiqueta productos, programa y hace POST con todo; error del upload se muestra", async () => {
    rutear((u, i) => {
      if (u === "/api/productos") return { body: PRODUCTOS };
      if (u === "/api/canales/instagram/upload") return { body: { url: "https://cdn/img.png" } };
      if (i?.method === "POST") return { body: {} };
    });
    render(<InstagramEditor />);
    fireEvent.click(await screen.findByText("Alimento - $9990"));
    fireEvent.click(screen.getByText("Alimento - $9990"));
    expect(screen.getAllByText("Alimento")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Story" }));
    fireEvent.change(screen.getByPlaceholderText("Escribe el caption..."), { target: { value: "Nuevo stock" } });
    expect(screen.getByText("11/2200 caracteres")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publicar Ahora" })).toBeDisabled();

    const archivo = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(archivo, { target: { files: [new File(["x"], "f.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getAllByAltText("Preview")).toHaveLength(2));
    fireEvent.change(document.querySelector('input[type="datetime-local"]')!, { target: { value: "2026-11-01T10:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Programar" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/canales/instagram/posts"));
    const [, init] = fetchMock.mock.calls.find(([u, i]) => u === "/api/canales/instagram/posts" && i?.method === "POST")!;
    expect(JSON.parse(init.body)).toEqual({
      content_type: "story", caption: "Nuevo stock", image_url: "https://cdn/img.png",
      product_tags: [{ productoId: "pr1", nombre: "Alimento", precio: 9990 }],
      scheduled_for: new Date("2026-11-01T10:30").toISOString(),
    });
  });

  it("IGP-08: REGRESIÓN — editar carga el post aunque no sea borrador y guarda con PATCH; quitar imagen y etiqueta", async () => {
    mockId = "p9";
    rutear((u, i) => {
      if (u === "/api/productos") return { body: [] };
      if (u === "/api/canales/instagram/posts") {
        return { body: [{ id: "p9", content_type: "carousel", caption: "Programado", image_url: "https://cdn/a.png", product_tags: [{ productoId: "x", nombre: "Tag", precio: 1 }], scheduled_for: "2026-11-02T13:00:00Z", status: "scheduled" }] };
      }
      if (i?.method === "PATCH") return { ok: false, body: { error: "No puedes editar posts publicados" } };
    });
    render(<InstagramEditor />);
    expect(await screen.findByDisplayValue("Programado")).toBeInTheDocument();
    expect(screen.getByText("Editar Publicación")).toBeInTheDocument();

    const quitar = screen.getAllByRole("button", { name: "✕" });
    fireEvent.click(quitar[1]);
    fireEvent.click(quitar[0]);
    expect(screen.getByText("Sin imagen")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Guardar como Borrador" }));
    expect(await screen.findByText("No puedes editar posts publicados")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === "PATCH")!;
    expect(url).toBe("/api/canales/instagram/posts/p9");
    expect(JSON.parse(init.body)).not.toHaveProperty("borrador");
  });

  it("IGP-09: REGRESIÓN — Guardar como Borrador manda borrador=true; error del upload y del guardado se muestran", async () => {
    rutear((u, i) => {
      if (u === "/api/productos") return { body: { error: "x" } };
      if (u === "/api/canales/instagram/upload") return { ok: false, body: { error: "El archivo no es una imagen válida" } };
      if (i?.method === "POST") return { ok: false, body: {} };
    });
    render(<InstagramEditor />);
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(["x"], "f.html")] } });
    expect(await screen.findByText("El archivo no es una imagen válida")).toBeInTheDocument();
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [] } });

    fireEvent.click(screen.getByRole("button", { name: "Guardar como Borrador" }));
    expect(await screen.findByText("Error guardando")).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls.find(([u, i]) => u === "/api/canales/instagram/posts" && i?.method === "POST")!;
    expect(JSON.parse(init.body)).toEqual({ content_type: "post", borrador: true });

    fireEvent.click(screen.getByRole("button", { name: "← Volver" }));
    expect(mockPush).toHaveBeenCalledWith("/canales/instagram/posts");
  });
});
