/**
 * Tests CD-01 a CD-10: ClienteDetalle — formulario de edición, saldo a favor, eliminación de mascotas y contador de compras de fidelización
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

const DETALLE_DATA = { ...CLIENTE, mascotas: [], ventas: [], saldo_disponible: 0 };

const MASCOTAS = [
  { id: "m1", nombre: "Grizzly", tipo: "perro", raza: "Shitsue", peso_kg: 8, gramos_porcion: 25, veces_dia: 3 },
  { id: "m2", nombre: "Luna", tipo: "gato", raza: null, peso_kg: null, gramos_porcion: null, veces_dia: null },
];
const DETALLE_CON_MASCOTAS = { ...CLIENTE, mascotas: MASCOTAS, ventas: [], saldo_disponible: 0 };

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

  // CD-03: REGRESIÓN — el perfil del cliente debe mostrar el saldo a favor cuando existe.
  // Bug original: ClienteDetalle nunca consultaba ni mostraba saldo_disponible.
  it("CD-03: muestra la sección de saldo a favor cuando saldo_disponible > 0", async () => {
    const detalleConSaldo = { ...DETALLE_DATA, saldo_disponible: 8990 };
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("fidelizacion")) {
        return Promise.resolve({ ok: false });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(detalleConSaldo),
      });
    });

    render(<ClienteDetalle cliente={CLIENTE} onRefresh={jest.fn()} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());

    expect(screen.getByText("Saldo a favor")).toBeInTheDocument();
    expect(screen.getByText(/8\.990/)).toBeInTheDocument();
    expect(screen.getByText("Aplicable en próxima compra")).toBeInTheDocument();
  });

  // CD-04: cuando saldo_disponible es 0, la sección no debe aparecer.
  it("CD-04: no muestra la sección de saldo a favor cuando saldo_disponible es 0", async () => {
    setupFetch();

    render(<ClienteDetalle cliente={CLIENTE} onRefresh={jest.fn()} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());

    expect(screen.queryByText("Saldo a favor")).not.toBeInTheDocument();
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

describe("ClienteDetalle — eliminación de mascotas", () => {
  beforeEach(() => jest.clearAllMocks());

  function setupFetchWithMascotas() {
    (global.fetch as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (typeof url === "string" && url.includes("fidelizacion")) {
        return Promise.resolve({ ok: false });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(DETALLE_CON_MASCOTAS),
      });
    });
  }

  // CD-05
  it("CD-05: muestra botón Eliminar por cada mascota", async () => {
    setupFetchWithMascotas();
    render(<ClienteDetalle cliente={CLIENTE} onRefresh={jest.fn()} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Grizzly")).toBeInTheDocument());

    const eliminarBtns = screen.getAllByText("Eliminar");
    expect(eliminarBtns).toHaveLength(2);
  });

  // CD-06
  it("CD-06: click en Eliminar muestra confirmación ¿Eliminar esta mascota?", async () => {
    setupFetchWithMascotas();
    render(<ClienteDetalle cliente={CLIENTE} onRefresh={jest.fn()} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Grizzly")).toBeInTheDocument());

    fireEvent.click(screen.getAllByText("Eliminar")[0]);

    expect(screen.getByText("¿Eliminar esta mascota?")).toBeInTheDocument();
    expect(screen.getByText("Sí, eliminar")).toBeInTheDocument();
    expect(screen.getByText("Cancelar")).toBeInTheDocument();
  });

  // CD-07
  it("CD-07: confirmar eliminación llama a DELETE /api/mascotas/[id] e invalida detalle", async () => {
    let deleteUrl = "";
    (global.fetch as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === "DELETE") {
        deleteUrl = String(url);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      if (typeof url === "string" && url.includes("fidelizacion")) {
        return Promise.resolve({ ok: false });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(DETALLE_CON_MASCOTAS),
      });
    });

    render(<ClienteDetalle cliente={CLIENTE} onRefresh={jest.fn()} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Grizzly")).toBeInTheDocument());

    fireEvent.click(screen.getAllByText("Eliminar")[0]);

    expect(screen.getByText("¿Eliminar esta mascota?")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Sí, eliminar"));

    await waitFor(() => {
      expect(deleteUrl).toBe("/api/mascotas/m1");
    });
  });
});

describe("ClienteDetalle — contador de compras en Fidelización", () => {
  beforeEach(() => jest.clearAllMocks());

  function setupFetchConFidelizacion(fidel: { total_historico: number; frecuencia_compras: number; descuento_actual: number }) {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("fidelizacion")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ...fidel,
              niveles: [
                { monto: 50000, descuento: 5 },
                { monto: 150000, descuento: 10 },
                { monto: 300000, descuento: 20 },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(DETALLE_DATA) });
    });
  }

  // CD-08: REGRESIÓN (ticket Trello 6a77e9d5cc6b547f60e1799b) — tras una
  // compra, la ficha debe mostrar "1 compra · $X acumulados" (singular).
  it("CD-08: muestra '1 compra · $12.990 acumulados' (singular) tras una compra", async () => {
    setupFetchConFidelizacion({ total_historico: 12990, frecuencia_compras: 1, descuento_actual: 0 });
    render(<ClienteDetalle cliente={CLIENTE} onRefresh={jest.fn()} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());

    expect(screen.getByText(/1 compra · \$12\.990 acumulados/)).toBeInTheDocument();
  });

  // CD-09: REGRESIÓN (ticket 6a77e9d5...) — tras devolver el 100% de una
  // venta, frecuencia_compras vuelve a 0: el contador debe mostrar
  // "0 compras · $0 acumulados". "1 compra · $0 acumulados" (monto 0 con
  // contador 1) era la firma del bug: total_historico se descontaba pero
  // frecuencia_compras no.
  it("CD-09: tras devolución total muestra '0 compras · $0 acumulados'", async () => {
    setupFetchConFidelizacion({ total_historico: 0, frecuencia_compras: 0, descuento_actual: 0 });
    render(<ClienteDetalle cliente={CLIENTE} onRefresh={jest.fn()} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());

    expect(screen.getByText(/0 compras · \$0 acumulados/)).toBeInTheDocument();
  });

  // CD-10: plural con 2+ compras.
  it("CD-10: muestra 'N compras' en plural cuando hay más de una", async () => {
    setupFetchConFidelizacion({ total_historico: 25980, frecuencia_compras: 2, descuento_actual: 0 });
    render(<ClienteDetalle cliente={CLIENTE} onRefresh={jest.fn()} />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Juan Pérez")).toBeInTheDocument());

    expect(screen.getByText(/2 compras · \$25\.980 acumulados/)).toBeInTheDocument();
  });
});
