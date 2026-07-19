/**
 * Tests CT-01 a CT-03: CategoriasTab — confirmación antes de eliminar
 * REGRESIÓN: click en Eliminar eliminaba la categoría sin preguntar
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@clerk/nextjs", () => ({ useUser: jest.fn() }));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, variant }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant}>{children}</button>
  ),
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

import { useUser } from "@clerk/nextjs";
import { CategoriasTab } from "@/app/(app)/inventory/components/CategoriasTab";

const CATEGORIAS_MOCK = [
  { id: "cat-1", nombre: "Alimentos", descripcion: "Comida para mascotas", activo: true, es_alimento: true },
  { id: "cat-2", nombre: "Juguetes", descripcion: null, activo: true, es_alimento: false },
];

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function setup() {
  (useUser as jest.Mock).mockReturnValue({
    user: { publicMetadata: { storeAdmin: true } },
  });
  mockFetch.mockResolvedValue({ ok: true, json: async () => CATEGORIAS_MOCK });
  render(<CategoriasTab />, { wrapper: makeWrapper() });
}

describe("CategoriasTab — confirmación eliminar (CT-XX)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // CT-01: click en "Eliminar" abre modal de confirmación
  it("CT-01: click en Eliminar muestra modal de confirmación", async () => {
    setup();

    await waitFor(() => expect(screen.getByText("Alimentos")).toBeInTheDocument());

    fireEvent.click(screen.getAllByText("Eliminar")[0]);

    expect(screen.getByText("¿Eliminar categoría?")).toBeInTheDocument();
    expect(screen.getByText("Cancelar")).toBeInTheDocument();
  });

  // CT-02: click en "Cancelar" cierra modal sin eliminar
  it("CT-02: click en Cancelar cierra modal sin llamar al API", async () => {
    setup();

    await waitFor(() => expect(screen.getByText("Alimentos")).toBeInTheDocument());

    fireEvent.click(screen.getAllByText("Eliminar")[0]);
    expect(screen.getByText("¿Eliminar categoría?")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancelar"));

    expect(screen.queryByText("¿Eliminar categoría?")).not.toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalledWith("/api/categorias/cat-1", { method: "DELETE" });
  });

  // CT-03: click en "Eliminar" del modal llama al API DELETE
  it("CT-03: confirmar eliminación llama a DELETE /api/categorias/[id]", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => CATEGORIAS_MOCK })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValue({ ok: true, json: async () => CATEGORIAS_MOCK });

    setup();

    await waitFor(() => expect(screen.getByText("Alimentos")).toBeInTheDocument());

    fireEvent.click(screen.getAllByText("Eliminar")[0]);

    const modal = screen.getByText("¿Eliminar categoría?").closest("[class*='fixed']")!;
    fireEvent.click(within(modal).getByText("Eliminar"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/categorias/cat-1", { method: "DELETE" });
    });
  });

  // CT-04: REGRESIÓN — editar categoría invalida ["categorias"] con refetchType "all"
  // para que la lista se actualice inmediatamente sin recargar la página.
  it("CT-04: REGRESIÓN — editar categoría invalida ['categorias'] con refetchType 'all'", async () => {
    const categoriasAntes = [...CATEGORIAS_MOCK];
    const categoriasDespues = [
      { ...CATEGORIAS_MOCK[0], nombre: "Alimentos Premium" },
      CATEGORIAS_MOCK[1],
    ];

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url === "/api/categorias" && !opts?.method) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(categoriasAntes) });
      }
      if (url.includes("/api/categorias/") && opts?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      if (url === "/api/categorias" && opts?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      // Refetch después de invalidar
      if (url === "/api/categorias") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(categoriasDespues) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    (useUser as jest.Mock).mockReturnValue({
      user: { publicMetadata: { storeAdmin: true } },
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = jest.spyOn(qc, "invalidateQueries");

    render(
      <QueryClientProvider client={qc}>
        <CategoriasTab />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByText("Alimentos")).toBeInTheDocument());

    // Click "Editar" en la primera categoría
    fireEvent.click(screen.getAllByText("Editar")[0]);

    // El formulario debe estar en modo edición
    expect(screen.getByDisplayValue("Alimentos")).toBeInTheDocument();

    // Cambiar el nombre
    fireEvent.change(screen.getByDisplayValue("Alimentos"), {
      target: { value: "Alimentos Premium" },
    });

    // Guardar
    fireEvent.click(screen.getByText("Guardar cambios"));

    // Verificar que se invalidó con refetchType "all"
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: ["categorias"], refetchType: "all" });
    });
    // No debe llamarse SIN refetchType: "all"
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["categorias"] });

    spy.mockRestore();
  });
});
