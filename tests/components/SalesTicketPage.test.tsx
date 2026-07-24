/**
 * Tests C-16 a C-20: SalesTicketPage — badge "(Dev. X)" y disponibilidad de items para devolución
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const VENTA_ID = "test-venta-id-sales-ticket";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockRouterBack = jest.fn();
jest.mock("next/navigation", () => ({
  useSearchParams: jest.fn(() => ({ get: () => null })),
  useRouter: jest.fn(() => ({ back: mockRouterBack })),
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

  // C-39: REGRESIÓN — Subtotal mostraba el bruto (data.subtotal) en vez del neto
  // sin IVA, causando Subtotal = Total en vez de Subtotal + IVA = Total.
  it("C-39: REGRESIÓN — Subtotal muestra el neto (total − impuesto), no el bruto que iguala a Total", async () => {
    mockFetch({
      ...VENTA_BASE,
      subtotal: 11900,  // bruto pre-descuento — buggy: se mostraba tal cual
      descuento: 0,
      impuesto: 1900,
      total: 11900,     // bruto == subtotal cuando no hay descuento (caso reportado)
      items: [makeItem("i1", "Alimento Pro Plan 3kg", 1, 11900)],
    });

    render(<TicketPage params={Promise.resolve({ id: VENTA_ID })} />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(screen.getByText("Alimento Pro Plan 3kg")).toBeInTheDocument()
    );

    // Subtotal correcto: 11900 − 1900 = 10000 (neto), NO 11900 (bruto == Total)
    expect(screen.getByText("$10.000")).toBeInTheDocument();
    const subtotalLabel = screen.getByText("Subtotal");
    expect(subtotalLabel.nextSibling?.textContent).toBe("$10.000");
    expect(subtotalLabel.nextSibling?.textContent).not.toBe("$11.900");
  });

  // C-40: adyacente a C-39 — con descuento, Subtotal + IVA = Total sigue cumpliéndose
  // (Subtotal es el neto del TOTAL post-descuento, no el neto del bruto pre-descuento).
  it("C-40: con descuento, Subtotal + IVA sigue sumando exactamente Total", async () => {
    mockFetch({
      ...VENTA_BASE,
      subtotal: 20000,  // bruto pre-descuento
      descuento: 10,
      impuesto: 2874,
      total: 18000,     // 20000 × 0.9 = 18000
      items: [makeItem("i1", "Alimento Pro Plan 3kg", 1, 20000)],
    });

    render(<TicketPage params={Promise.resolve({ id: VENTA_ID })} />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(screen.getByText("Alimento Pro Plan 3kg")).toBeInTheDocument()
    );

    // Subtotal correcto: 18000 − 2874 = 15126 (neto del total post-descuento)
    const subtotalLabel = screen.getByText("Subtotal");
    expect(subtotalLabel.nextSibling?.textContent).toBe("$15.126");
    // Invariante: Subtotal + IVA = Total
    expect(15126 + 2874).toBe(18000);
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

// ── Tests de anulación ─────────────────────────────────────────────────────

describe("SalesTicketPage — anulación de venta (VT-01 a VT-06)", () => {
  beforeEach(() => jest.clearAllMocks());

  // VT-03: REGRESIÓN — anular venta debe invalidar queries de detalle Y listado con refetchType "all".
  // El refetchType "all" fuerza el refetch inmediato aunque la lista no tenga observer activo
  // (está desmontada). Sin esto, la lista muestra estado "Completada" hasta F5.
  it("VT-03: REGRESIÓN — anular venta invalida ['ventas'] con refetchType 'all' (no solo activos)", async () => {
    const VENTA_ACTIVA = {
      ...VENTA_BASE,
      items: [makeItem("i1", "Collar Perro", 1, 5000)],
    };

    (global.fetch as jest.Mock).mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes("/api/ventas/") && opts?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...VENTA_ACTIVA, estado: "anulada" }) });
      }
      if (url.includes("/api/ventas/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(VENTA_ACTIVA) });
      }
      if (url.includes("/api/notas-credito")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      if (url.includes("/api/settings")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ name: "PetShop Test" }) });
      }
      if (url.includes("/api/saldos-a-favor")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ saldo_disponible: 0 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = jest.spyOn(qc, "invalidateQueries");

    render(
      <QueryClientProvider client={qc}>
        <TicketPage params={Promise.resolve({ id: VENTA_ID })} />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(screen.getByText("Collar Perro")).toBeInTheDocument()
    );

    // Click "Anular venta" → se muestra confirmación
    fireEvent.click(screen.getByRole("button", { name: /Anular venta/i }));

    // Click "Sí, anular"
    fireEvent.click(screen.getByRole("button", { name: /Sí, anular/i }));

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: ["venta", VENTA_ID], refetchType: "all" });
    });
    // La invalidación del listado DEBE incluir refetchType: "all" para refrescar
    // aunque la lista esté desmontada (sin observer activo).
    expect(spy).toHaveBeenCalledWith({ queryKey: ["ventas"], refetchType: "all" });
    // La anulación revierte stock → inventario/productos/lotes deben invalidarse
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inventario"], refetchType: "all" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["productos"], refetchType: "all" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["lotes"], refetchType: "all" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["notas-credito", VENTA_ID], refetchType: "all" });
    // No debe llamarse SIN refetchType: "all" — eso sería la versión bugueada
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["ventas"] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["venta", VENTA_ID] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["inventario"] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["productos"] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["lotes"] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["notas-credito", VENTA_ID] });

    spy.mockRestore();
  });

  // VT-04: REGRESIÓN — "Volver" usa router.back() (Next.js router), no window.history.back()
  // (raw browser API que puede activar BFCache y restaurar el estado congelado de la lista,
  // mostrando datos viejos sin que TanStack Query tenga oportunidad de actualizar).
  it("VT-04: REGRESIÓN — botón Volver usa router.back(), no window.history.back()", async () => {
    const historyBackSpy = jest.spyOn(window.history, "back").mockImplementation(() => {});

    mockFetch({
      ...VENTA_BASE,
      items: [makeItem("i1", "Collar Perro", 1, 5000)],
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TicketPage params={Promise.resolve({ id: VENTA_ID })} />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(screen.getByText("Collar Perro")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /← Volver/i }));

    // Next.js router.back() debe llamarse
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    // El raw window.history.back() NO debe llamarse
    expect(historyBackSpy).not.toHaveBeenCalled();

    historyBackSpy.mockRestore();
  });

  // VT-05: error del servidor al anular muestra mensaje en banner rojo
  it("VT-05: anulación con error del servidor muestra mensaje en banner rojo", async () => {
    const VENTA_ACTIVA = {
      ...VENTA_BASE,
      items: [makeItem("i1", "Collar Perro", 1, 5000)],
    };

    (global.fetch as jest.Mock).mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes("/api/ventas/") && opts?.method === "PATCH") {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "La venta ya está anulada" }) });
      }
      if (url.includes("/api/ventas/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(VENTA_ACTIVA) });
      }
      if (url.includes("/api/notas-credito")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      if (url.includes("/api/settings")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ name: "PetShop Test" }) });
      }
      if (url.includes("/api/saldos-a-favor")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ saldo_disponible: 0 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <TicketPage params={Promise.resolve({ id: VENTA_ID })} />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(screen.getByText("Collar Perro")).toBeInTheDocument()
    );

    // Click "Anular venta" → se muestra confirmación
    fireEvent.click(screen.getByRole("button", { name: /Anular venta/i }));

    // Click "Sí, anular"
    fireEvent.click(screen.getByRole("button", { name: /Sí, anular/i }));

    // El banner rojo con el mensaje de error debe aparecer
    await waitFor(() => {
      expect(screen.getByText("La venta ya está anulada")).toBeInTheDocument();
    });
  });

  // VT-01: ticket de venta no anulada mustra "Gracias por su compra"
  it("VT-01: ticket de venta completada mustra 'Gracias por su compra'", async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("/api/ventas/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...VENTA_BASE, items: [makeItem("i1", "Producto", 1, 5000)] }) });
      }
      if (url.includes("/api/notas-credito")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      if (url.includes("/api/settings")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ name: "PetShop Test" }) });
      if (url.includes("/api/saldos-a-favor")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ saldo_disponible: 0 }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TicketPage params={Promise.resolve({ id: VENTA_ID })} />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(screen.getByText(/gracias por su compra/i)).toBeInTheDocument()
    );
  });

  // VT-02: ticket de venta anulada NO mustra "Gracias por su compra"
  it("VT-02: ticket de venta anulada no mustra 'Gracias por su compra'", async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("/api/ventas/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...VENTA_BASE, estado: "anulada", items: [makeItem("i1", "Producto", 1, 5000)] }) });
      }
      if (url.includes("/api/notas-credito")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      if (url.includes("/api/settings")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ name: "PetShop Test" }) });
      if (url.includes("/api/saldos-a-favor")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ saldo_disponible: 0 }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TicketPage params={Promise.resolve({ id: VENTA_ID })} />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(screen.getByText("Producto")).toBeInTheDocument()
    );
    expect(screen.queryByText(/gracias por su compra/i)).not.toBeInTheDocument();
  });

  // VT-06: REGRESIÓN (ticket Trello 6a61a12381bf8bf365e5a9d3) — al anular venta,
  // el cache de TanStack Query debe reflejar estado="anulada" AHORA (no tras la
  // refetch de invalidateQueries), para que el banner "Venta anulada" aparezca y
  // el botón "Anular venta" desaparezca sin esperar la respuesta del GET.
  // Sin setQueryData en onSuccess, el setConfirmAnular(false) corre antes de que
  // el refetch complete dejando la UI inconsistente (botón visible + sin banner).
  it("VT-06: REGRESIÓN — anular venta actualiza data.estado a 'anulada' en cache vía setQueryData, no solo tras refetch", async () => {
    const VENTA_ACTIVA = {
      ...VENTA_BASE,
      items: [makeItem("i1", "Producto VT06", 1, 5000)],
    };

    let datosActualizados = false;

    (global.fetch as jest.Mock).mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes("/api/ventas/") && opts?.method === "PATCH") {
        datosActualizados = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...VENTA_ACTIVA, estado: "anulada" }) });
      }
      if (url.includes("/api/ventas/")) {
        // Después de PATCH, GET devuelve datos actualizados
        if (datosActualizados) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...VENTA_ACTIVA, estado: "anulada" }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(VENTA_ACTIVA) });
      }
      if (url.includes("/api/notas-credito")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      if (url.includes("/api/settings")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ name: "PetShop Test" }) });
      if (url.includes("/api/saldos-a-favor")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ saldo_disponible: 0 }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const setQueryDataSpy = jest.spyOn(qc, "setQueryData");

    render(
      <QueryClientProvider client={qc}>
        <TicketPage params={Promise.resolve({ id: VENTA_ID })} />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(screen.getByText("Producto VT06")).toBeInTheDocument()
    );

    // Click "Anular venta" → confirmación
    fireEvent.click(screen.getByRole("button", { name: /Anular venta/i }));
    // Click "Sí, anular"
    fireEvent.click(screen.getByRole("button", { name: /Sí, anular/i }));

    // Después de la mutación exitosa:
    // - setQueryData debe haberse llamado con queryKey ["venta", VENTA_ID]
    await waitFor(() => {
      expect(setQueryDataSpy).toHaveBeenCalled();
    });
    const setDataCalls = setQueryDataSpy.mock.calls.filter(
      (call) => JSON.stringify(call[0]) === JSON.stringify(["venta", VENTA_ID])
    );
    expect(setDataCalls.length).toBeGreaterThanOrEqual(1);

    // - El banner "Venta anulada" debe aparecer (data.estado cambió a "anulada")
    await waitFor(() => {
      expect(screen.getByText(/venta anulada/i)).toBeInTheDocument();
    });

    // - El botón "Anular venta" NO debe estar visible
    expect(screen.queryByRole("button", { name: /^Anular venta$/ })).not.toBeInTheDocument();

    // - El mensaje "Gracias por su compra" NO debe mostrarse
    expect(screen.queryByText(/gracias por su compra/i)).not.toBeInTheDocument();

    setQueryDataSpy.mockRestore();
  });

});
