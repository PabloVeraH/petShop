/**
 * Tests para ProductoImagenesField
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProductoImagenesField } from "@/app/(app)/inventory/components/ProductoImagenesField";

const mockOnChange = jest.fn();
const PRODUCTO_ID = "323e4567-e89b-12d3-a456-426614174050";

function renderField(overrides: { imagenUrl?: string | null; imagenUrl2?: string | null; productoId?: string } = {}) {
  return render(
    <ProductoImagenesField
      imagenUrl={overrides.imagenUrl ?? null}
      imagenUrl2={overrides.imagenUrl2 ?? null}
      productoId={overrides.productoId ?? PRODUCTO_ID}
      onChange={mockOnChange}
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe("ProductoImagenesField", () => {
  it("CMP-IMG-01: renderiza ambos slots vacíos con botón de selección", () => {
    renderField();
    expect(screen.getByText("Foto principal")).toBeInTheDocument();
    expect(screen.getByText("Foto secundaria")).toBeInTheDocument();
    expect(screen.getAllByText("Seleccionar imagen")).toHaveLength(2);
  });

  it("CMP-IMG-02: renderiza miniatura cuando hay URL existente", () => {
    renderField({ imagenUrl: "https://pub-test.r2.dev/productos/store1/img1.webp" });
    const imgs = screen.getAllByRole("img");
    expect(imgs[0]).toHaveAttribute("src", "https://pub-test.r2.dev/productos/store1/img1.webp");
    expect(screen.getByText("Eliminar")).toBeInTheDocument();
  });

  it("CMP-IMG-03: seleccionar archivo dispara POST a /api/productos/imagenes", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://pub-test.r2.dev/productos/store1/new.webp" }),
    });

    renderField();

    const fileInput = document.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    const file = new File(["dummy"], "photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 1024 });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/productos/imagenes",
        expect.objectContaining({ method: "POST" })
      );
    });

    expect(mockOnChange).toHaveBeenCalledWith("imagen_url", "https://pub-test.r2.dev/productos/store1/new.webp");
  });

  it("CMP-IMG-06: la subida incluye productoId en el FormData (organización por producto en R2)", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://pub-test.r2.dev/productos/store1/new.webp" }),
    });

    renderField({ productoId: PRODUCTO_ID });

    const fileInput = document.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    const file = new File(["dummy"], "photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 1024 });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = init.body as FormData;
    expect(body.get("productoId")).toBe(PRODUCTO_ID);
  });

  it("CMP-IMG-04: error de API se muestra en el slot, no en formError", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Tipo no permitido" }),
    });

    renderField();

    const fileInput = document.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    const file = new File(["dummy"], "doc.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: 1024 });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Tipo no permitido")).toBeInTheDocument();
    });

    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it("CMP-IMG-05: eliminar slot con URL llama a DELETE y limpiapipe el campo", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

    renderField({ imagenUrl: "https://pub-test.r2.dev/productos/store1/old.webp" });

    fireEvent.click(screen.getByText("Eliminar"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/productos/imagenes",
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ url: "https://pub-test.r2.dev/productos/store1/old.webp" }),
        })
      );
    });

    expect(mockOnChange).toHaveBeenCalledWith("imagen_url", null);
  });
});
