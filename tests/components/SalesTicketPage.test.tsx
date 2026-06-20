/**
 * Tests C-16 a C-20: SalesTicketPage — badge "(Dev. X)" y disponibilidad de items para devolución
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const VENTA_ID = "test-venta-id-sales-ticket";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("next/navigation", () => ({
  useSearchParams: jest.fn(() => ({ get: () => null })),
}));

jest.mock("react", () => {
  const actual = jest.requireActual("react");
  return {
    ...actual,
    use: jest.fn((input: unknown) =>
      input && typeof (input as any).then === "function"
        ? { id: VENTA_ID }
        : actual.use(input)
    ),
  };
});

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children, onClick, disabled, title,
  }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  ),
}));

jest.mock("@/components/sales/DevolucionModal", () => ({
  DevolucionModal: () => null,
}));

global.fetch = jest.fn();

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const VENTA_BASE = {
  id: VENTA_ID,
  numero_comprobante: "20260504-TEST",
  subtotal: 100000,
  descuento: 0,
  impuesto: 19000,
  total: 119000,
  metodo_pago: "efectivo",
  estado: "completada",
  created_at: "2026-05-04T07:30:00.000Z",
  clientes: null,
  worker: { nombre: null, email: "admin@petshop.local" },
};

function makeItem(id: string, nombre: string, cantidad: number, precio: number) {
  return { id, cantidad, precio_unitario: precio, subtotal: cantidad * precio, productos: { nombre, sku: "SKU" } };
}

function makeNc(id: string, venta_item_id: string, cantidad_devuelta: number) {
  return {
    id,
    numero_nc: `NC-TEST-${id}`,
    monto_total: 5000,
    tipo_reembolso: "saldo_a_favor",
    motivo: null,
    created_at: "2026-05-08T04:00:00.000Z",
    nota_credito_items: [{ venta_item_id, cantidad_devuelta }],
  };
}

function mockFetch(venta: object, notasCredito: object[] = []) {
  (global.fetch as jest.Mock).mockImplementation((url: string) => {
    if (url.includes("/api/ventas/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(venta) });
    }
    if (url.includes("/api/notas-credito")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: notasCredito }) });
    }
    if (url.includes("/api/settings")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ name: "PetShop Test" }) });
    }
    if (url.includes("/api/saldos-a-favor")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ saldo_disponible: 0 }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ── Import after mocks ────────────────────────────────────────────────────────

import TicketPage from "@/app/(app)/sales/[id]/page";

// ── Tests ─────────────────────────────────────────────────────────────────────

// ── Tests de descuento ────────────────────────────────────────────────────────

describe("SalesTicketPage — display de descuento (C-23/C-24)", () => {
  beforeEach(() => jest.clearAllMocks());

  // C-23: REGRESIÓN — descuento se almacena como % y debe mostrarse como monto en pesos
  it("C-23: descuento 10% sobre subtotal $44.800 muestra '-$4.480', no '-$10'", async () => {
    mockFetch({
      ...VENTA_BASE,
      subtotal: 44800,
      descuento: 10,     // porcentaje almacenado en DB
      impuesto: 7646,
      total: 40320,      // 44800 × 0.9 = 40320
      items: [makeItem("i1", "Alimento Pro Plan 3kg", 1, 44800)],
    });

    render(<TicketPage params={Promise.resolve({ id: VENTA_ID })} />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(screen.getByText("Descuento (10%)")).toBeInTheDocument()
    );
    // Monto correcto: 44800 × 10% = 4480, NO "$10"
    expect(screen.getByText("−$4.480")).toBeInTheDocument();
    expect(screen.queryByText("−$10")).not.toBeInTheDocument();
  });

  // C-24: sin descuento no aparece la línea de descuento
  it("C-24: venta sin descuento no muestra línea 'Descuento'", async () => {
    mockFetch({
      ...VENTA_BASE,
      subtotal: 44800,
      descuento: 0,
      total: 44800,
      items: [makeItem("i1", "Alimento Pro Plan 3kg", 1, 44800)],
    });

    render(<TicketPage params={Promise.resolve({ id: VENTA_ID })} />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(screen.getByText("Alimento Pro Plan 3kg")).toBeInTheDocument()
    );
    expect(screen.queryByText(/Descuento/)).not.toBeInTheDocument();
  });
});

// ── Tests de devoluciones ─────────────────────────────────────────────────────

describe("SalesTicketPage — badge Dev. X y disponibilidad de items", () => {
  beforeEach(() => jest.clearAllMocks());

  // C-16
  it("C-16: items sin devoluciones no muestran (Dev. X)", async () => {
    mockFetch(
      { ...VENTA_BASE, items: [makeItem("i1", "Collar Ajustable M", 2, 5000)] },
      []
    );

    render(<TicketPage params={Promise.resolve({ id: VENTA_ID })} />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(screen.getByText("Collar Ajustable M")).toBeInTheDocument()
    );
    expect(screen.queryByText(/Dev\./)).not.toBeInTheDocument();
  });

  // C-17
  it("C-17: item con devolución parcial muestra (Dev. 1) junto a ×2", async () => {
    mockFetch(
      { ...VENTA_BASE, items: [makeItem("i1", "Alimento Perro Pro Plan 3kg", 2, 5000)] },
      [makeNc("nc1", "i1", 1)]
    );

    render(<TicketPage params={Promise.resolve({ id: VENTA_ID })} />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(screen.getByText("Alimento Perro Pro Plan 3kg")).toBeInTheDocument()
    );
    expect(screen.getByText("(Dev. 1)")).toBeInTheDocument();
  });

  // C-18
  it("C-18: item totalmente devuelto muestra (Dev. 2) junto a ×2", async () => {
    mockFetch(
      { ...VENTA_BASE, items: [makeItem("i1", "Alimento Gato Whiskas 1kg", 2, 5000)] },
      [makeNc("nc1", "i1", 2)]
    );

    render(<TicketPage params={Promise.resolve({ id: VENTA_ID })} />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(screen.getByText("Alimento Gato Whiskas 1kg")).toBeInTheDocument()
    );
    expect(screen.getByText("(Dev. 2)")).toBeInTheDocument();
  });

  // C-19
  it("C-19: devoluciones de múltiples NCs se acumulan en el badge", async () => {
    mockFetch(
      { ...VENTA_BASE, items: [makeItem("i1", "Snack Dental Perro", 3, 5000)] },
      [makeNc("nc1", "i1", 1), makeNc("nc2", "i1", 1)]
    );

    render(<TicketPage params={Promise.resolve({ id: VENTA_ID })} />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(screen.getByText("Snack Dental Perro")).toBeInTheDocument()
    );
    expect(screen.getByText("(Dev. 2)")).toBeInTheDocument();
  });

  // C-20
  it("C-20: botón 'Devolución parcial' deshabilitado cuando todos los items están devueltos", async () => {
    mockFetch(
      { ...VENTA_BASE, items: [makeItem("i1", "Collar Ajustable M", 1, 5000)] },
      [makeNc("nc1", "i1", 1)]
    );

    render(<TicketPage params={Promise.resolve({ id: VENTA_ID })} />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(screen.getByText("Collar Ajustable M")).toBeInTheDocument()
    );
    const btn = screen.getByRole("button", { name: /Devolución parcial/i });
    expect(btn).toBeDisabled();
  });
});
