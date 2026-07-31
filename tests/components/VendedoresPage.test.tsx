/**
 * Tests V-01 a V-09: VendedoresPage — listado, detalle y Meta mensual editable
 * @jest-environment jsdom
 *
 * V-01  Admin ve lista de vendedores
 * V-02  "Ver detalle" abre el dialog
 * V-03  REGRESIÓN — Meta mensual acepta input (type text + inputMode numeric)
 * V-04  RUT input también es editable
 * V-05  Guardar cambios llama a PATCH /api/workers con meta_ventas
 * V-06  Worker (sin storeAdmin) ve mensaje "No tienes acceso"
 * V-07  REGRESIÓN — typing en RUT no dispara guardado automático
 * V-08  RUT input muestra el RUT del trabajador cuando existe
 * V-09  Guardar cambios envía RUT en body de PATCH y cierra modal
 * V-10  REGRESIÓN (ticket Trello 6a61a7d503d4609a4cea7cdc): Meta mensual con
 *       signo negativo no se trunca silenciosamente a un valor positivo —
 *       muestra error y bloquea "Guardar cambios"
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

jest.mock("@clerk/nextjs", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children, onClick, disabled, variant, size,
  }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: string; size?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}));

// The Dialog uses Radix primitives; mock it so we can test open/close
jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) =>
    <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const WORKERS = [
  {
    clerk_id: "w1",
    nombre: "María Pérez",
    email: "maria@test.com",
    rut: "12.345.678-5",
    meta_ventas: null,
    store_admin: false,
    store_worker: true,
    ventas_mes: 150000,
    ventas_hoy: 25000,
  },
  {
    clerk_id: "w2",
    nombre: "Carlos López",
    email: "carlos@test.com",
    rut: null,
    meta_ventas: 500000,
    store_admin: false,
    store_worker: true,
    ventas_mes: 320000,
    ventas_hoy: 45000,
  },
];

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => WORKERS,
});

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function mockAsAdmin() {
  const { useAuth } = jest.requireMock("@clerk/nextjs");
  useAuth.mockReturnValue({
    sessionClaims: { publicMetadata: { storeAdmin: true } },
  });
}

function mockAsWorker() {
  const { useAuth } = jest.requireMock("@clerk/nextjs");
  useAuth.mockReturnValue({
    sessionClaims: { publicMetadata: { storeWorker: true } },
  });
}

import VendedoresPage from "@/app/(app)/vendedores/page";

describe("VendedoresPage — listado y acceso", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockReset();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => WORKERS,
    });
  });

  // V-01
  it("V-01: admin ve lista de vendedores con nombre y ventas", async () => {
    mockAsAdmin();
    render(<VendedoresPage />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("María Pérez")).toBeInTheDocument());
    expect(screen.getByText("Carlos López")).toBeInTheDocument();
    expect(screen.getByText("$150.000")).toBeInTheDocument();
  });

  // V-06
  it("V-06: worker sin storeAdmin ve mensaje de acceso denegado", async () => {
    mockAsWorker();
    render(<VendedoresPage />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("No tienes acceso a esta página")).toBeInTheDocument()
    );
    expect(screen.queryByText("María Pérez")).not.toBeInTheDocument();
  });
});

describe("VendedoresPage — detalle y meta mensual", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockReset();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => WORKERS,
    });
    mockAsAdmin();
  });

  // V-02
  it("V-02: 'Ver detalle' abre el dialog con nombre del vendedor", async () => {
    render(<VendedoresPage />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("María Pérez")).toBeInTheDocument());

    fireEvent.click(screen.getAllByText("Ver detalle")[0]);

    await waitFor(() => {
      expect(screen.getByText(/María Pérez/i)).toBeInTheDocument();
    });
  });

  // V-03 — REGRESIÓN principal
  it("V-03: Meta mensual acepta input (regresión type number en React 19)", async () => {
    render(<VendedoresPage />, { wrapper: makeWrapper() });

    // Carlos López (sorted first, meta_ventas=500000)
    await waitFor(() => expect(screen.getByText("Carlos López")).toBeInTheDocument());
    fireEvent.click(screen.getAllByText("Ver detalle")[0]);

    await waitFor(() => {
      expect(screen.getByText(/Meta mensual/i)).toBeInTheDocument();
    });

    // Query por display value (no label association con input)
    const input = screen.getByDisplayValue("500000") as HTMLInputElement;
    expect(input).toBeInTheDocument();

    // Simular escritura
    fireEvent.change(input, { target: { value: "800000" } });
    expect(input.value).toBe("800000");

    // Debe rechazar caracteres no numéricos
    fireEvent.change(input, { target: { value: "800abc" } });
    expect(input.value).toBe("800");
  });

  // V-04
  it("V-04: RUT input también es editable", async () => {
    render(<VendedoresPage />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Carlos López")).toBeInTheDocument());
    fireEvent.click(screen.getAllByText("Ver detalle")[0]);

    await waitFor(() => {
      expect(screen.getByText(/Meta mensual/i)).toBeInTheDocument();
    });

    const rutInput = screen.getByPlaceholderText("12.345.678-9") as HTMLInputElement;
    expect(rutInput).toBeInTheDocument();
    fireEvent.change(rutInput, { target: { value: "12.345.678-9" } });
    expect(rutInput.value).toBe("12.345.678-9");
  });

  // V-05
  it("V-05: 'Guardar cambios' llama a PATCH /api/workers con meta_ventas", async () => {
    let patchBody: object | null = null;
    (global.fetch as jest.Mock).mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes("/api/workers") && opts?.method === "PATCH") {
        patchBody = JSON.parse(opts.body as string);
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      // GET sigue devolviendo los workers
      return Promise.resolve({ ok: true, json: async () => WORKERS });
    });

    render(<VendedoresPage />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Carlos López")).toBeInTheDocument());
    fireEvent.click(screen.getAllByText("Ver detalle")[0]);

    await waitFor(() => {
      expect(screen.getByText(/Meta mensual/i)).toBeInTheDocument();
    });

    const metaInput = screen.getByDisplayValue("500000") as HTMLInputElement;
    fireEvent.change(metaInput, { target: { value: "800000" } });

    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => {
      expect(patchBody).not.toBeNull();
    });
    expect(patchBody).toHaveProperty("clerk_id", "w2"); // Carlos López es el primero tras sort
    expect(patchBody).toHaveProperty("meta_ventas", 800000);
  });

  // V-07 — REGRESIÓN: auto-save no debe dispararse al editar RUT
  it("V-07: typing en RUT no dispara guardado automático", async () => {
    let patchCalls = 0;
    (global.fetch as jest.Mock).mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes("/api/workers") && opts?.method === "PATCH") {
        patchCalls++;
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({ ok: true, json: async () => WORKERS });
    });

    render(<VendedoresPage />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Carlos López")).toBeInTheDocument());
    fireEvent.click(screen.getAllByText("Ver detalle")[0]);

    await waitFor(() => {
      expect(screen.getByText(/Meta mensual/i)).toBeInTheDocument();
    });

    const rutInput = screen.getByPlaceholderText("12.345.678-9") as HTMLInputElement;
    expect(rutInput).toBeInTheDocument();

    // Simular múltiples cambios en RUT (triple clic + escritura)
    fireEvent.change(rutInput, { target: { value: "11.111.111-1" } });
    fireEvent.change(rutInput, { target: { value: "22.222.222-2" } });
    fireEvent.change(rutInput, { target: { value: "33.333.333-3" } });

    // Verificar que NO se llamó a PATCH automáticamente
    expect(patchCalls).toBe(0);

    // Verificar que el botón aún muestra "Guardar cambios" (no "Guardando...")
    expect(screen.getByText("Guardar cambios")).toBeInTheDocument();

    // Hacer clic explícito y verificar que SÍ se llama a PATCH
    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => {
      expect(patchCalls).toBe(1);
    });
  });

  // V-08
  it("V-08: RUT input muestra el RUT del trabajador cuando existe", async () => {
    render(<VendedoresPage />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("María Pérez")).toBeInTheDocument());
    // María Pérez es la segunda tras sort (ventas_mes 150000 < Carlos 320000)
    fireEvent.click(screen.getAllByText("Ver detalle")[1]);

    await waitFor(() => {
      expect(screen.getByTestId("dialog-root")).toBeInTheDocument();
    });

    const rutInput = screen.getByPlaceholderText("12.345.678-9") as HTMLInputElement;
    expect(rutInput.value).toBe("12.345.678-5");
  });

  // V-09
  it("V-09: Guardar cambios envía RUT en body de PATCH y cierra modal", async () => {
    let patchBody: object | null = null;
    (global.fetch as jest.Mock).mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes("/api/workers") && opts?.method === "PATCH") {
        patchBody = JSON.parse(opts.body as string);
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({ ok: true, json: async () => WORKERS });
    });

    render(<VendedoresPage />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Carlos López")).toBeInTheDocument());
    fireEvent.click(screen.getAllByText("Ver detalle")[0]);

    await waitFor(() => {
      expect(screen.getByText(/Meta mensual/i)).toBeInTheDocument();
    });

    const rutInput = screen.getByPlaceholderText("12.345.678-9") as HTMLInputElement;
    fireEvent.change(rutInput, { target: { value: "11.111.111-1" } });

    fireEvent.click(screen.getByText("Guardar cambios"));

    await waitFor(() => {
      expect(patchBody).not.toBeNull();
    });
    expect(patchBody).toHaveProperty("clerk_id", "w2");
    expect(patchBody).toHaveProperty("rut", "11.111.111-1");

    // El modal se cierra después de guardar
    await waitFor(() => {
      expect(screen.queryByText(/Meta mensual/i)).not.toBeInTheDocument();
    });
  });

  // V-10 — REGRESIÓN (ticket Trello 6a61a7d503d4609a4cea7cdc): antes, el
  // onChange de Meta mensual descartaba silenciosamente cualquier carácter
  // no numérico (incluido el signo "-") sin mostrar error. Al escribir
  // "-1000", el resultado quedaba en "1000" — un valor positivo pero
  // completamente distinto al que el usuario intentó ingresar, guardado sin
  // ninguna advertencia y distorsionando el cálculo de "Avance".
  it("V-10: Meta mensual con signo negativo muestra error y bloquea Guardar (no trunca a positivo en silencio)", async () => {
    let patchCalls = 0;
    (global.fetch as jest.Mock).mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes("/api/workers") && opts?.method === "PATCH") {
        patchCalls++;
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({ ok: true, json: async () => WORKERS });
    });

    render(<VendedoresPage />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Carlos López")).toBeInTheDocument());
    fireEvent.click(screen.getAllByText("Ver detalle")[0]);

    await waitFor(() => {
      expect(screen.getByText(/Meta mensual/i)).toBeInTheDocument();
    });

    const metaInput = screen.getByDisplayValue("500000") as HTMLInputElement;
    fireEvent.change(metaInput, { target: { value: "-1000" } });

    // El valor no debe truncarse silenciosamente a "1000"
    expect(metaInput.value).not.toBe("1000");

    await waitFor(() => {
      expect(screen.getByText(/meta.*(debe ser|positiv)/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Guardar cambios"));

    // No debe enviarse ningún PATCH mientras el valor sea inválido
    expect(patchCalls).toBe(0);
  });
});
