/**
 * Tests CD-01, CD-02: ClienteDetalle — el formulario de edición debe incluir campo RUT
 * REGRESIÓN: antes del fix, el form de edición omitía el RUT, impidiendo corregirlo.
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

jest.mock("@/app/(app)/customers/components/ModalMascotaCreate", () => ({
  __esModule: true,
  default: () => null,
}));

global.fetch = jest.fn();

// ── Imports ───────────────────────────────────────────────────────────────────

import ClienteDetalle from "@/app/(app)/customers/components/ClienteDetalle";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLIENTE_ID = "123e4567-e89b-12d3-a456-426614174020";

const CLIENTE = {
  id: CLIENTE_ID,
  store_id: "123e4567-e89b-12d3-a456-426614174000",
  rut: "11.111.111-1",
  nombre: "Juan Pérez",
  email: "juan@test.com",
  telefono: null,
};

const DETALLE_DATA = { ...CLIENTE, mascotas: [], ventas: [] };

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function setupFetch(patchOverride?: object) {
  (global.fetch as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
    if (options?.method === "PATCH") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(patchOverride ?? { ...CLIENTE }),
      });
    }
    if (typeof url === "string" && url.includes("fidelizacion")) {
      return Promise.resolve({ ok: false });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(DETALLE_DATA),
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ClienteDetalle — campo RUT en formulario de edición", () => {
  beforeEach(() => jest.clearAllMocks());

  // CD-01: REGRESIÓN — el formulario de edición debe mostrar el RUT pre-poblado.
  // Bug original: EditClienteForm omitía rut; el campo nunca aparecía en edición.
  it("CD-01: el formulario de edición muestra el campo RUT pre-poblado con el RUT del cliente", async () => {
    setupFetch();
    render(<ClienteDetalle cliente={CLIENTE} onRefresh={jest.fn()} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Editar"));

    expect(screen.getByDisplayValue("11.111.111-1")).toBeInTheDocument();
  });

  // CD-02: REGRESIÓN — al guardar, el PATCH debe incluir el RUT en el body.
  it("CD-02: al guardar, el body del PATCH incluye el campo rut del cliente", async () => {
    setupFetch();
    render(<ClienteDetalle cliente={CLIENTE} onRefresh={jest.fn()} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Editar"));
    fireEvent.click(screen.getByText("Guardar"));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/clientes/${CLIENTE_ID}`,
        expect.objectContaining({ method: "PATCH" })
      )
    );

    const patchCall = (global.fetch as jest.Mock).mock.calls.find(
      ([, opts]: [string, RequestInit]) => opts?.method === "PATCH"
    );
    const body = JSON.parse(patchCall[1].body as string);
    expect(body.rut).toBe("11.111.111-1");
  });
});
