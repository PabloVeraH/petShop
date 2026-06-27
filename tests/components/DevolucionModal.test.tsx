/**
 * Tests DV-01 a DV-10: DevolucionModal — selección de ítems, habilitar Continuar y flujo paso 2
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children, onClick, disabled,
  }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

jest.mock("@/components/ui/input", () => ({
  Input: ({
    value, onChange, onClick, onKeyDown, min, max, type, className,
  }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      type={type}
      value={value}
      onChange={onChange}
      onClick={onClick}
      onKeyDown={onKeyDown}
      min={min}
      max={max}
      className={className}
    />
  ),
}));

const mockInvalidateQueries = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

global.fetch = jest.fn();

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ITEM_1 = {
  id: "item-1",
  cantidad: 2,
  precio_unitario: 10000,
  subtotal: 20000,
  productos: { nombre: "Alimento Premium 1kg" },
};

const ITEM_2 = {
  id: "item-2",
  cantidad: 1,
  precio_unitario: 5000,
  subtotal: 5000,
  productos: { nombre: "Juguete Pelota" },
};

const BASE_PROPS = {
  isOpen: true,
  ventaId: "venta-test-123",
  ventaTotal: 25000,
  items: [ITEM_1, ITEM_2],
  clienteId: "cliente-1",
  onClose: jest.fn(),
  onSuccess: jest.fn(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function setup(overrideProps = {}) {
  const props = { ...BASE_PROPS, ...overrideProps };
  render(
    <DevolucionModal {...props} />,
    { wrapper: makeWrapper() }
  );
  return props;
}

import { DevolucionModal } from "@/components/sales/DevolucionModal";

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("DevolucionModal — Paso 1: selección de ítems", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ numeroNc: "NC-20260624-ABC12345", notaCreditoId: "nc-id-1" }),
    });
  });

  // DV-01: REGRESIÓN — el checkbox responde al click y activa el botón Continuar
  it("DV-01: al hacer click en el checkbox del primer ítem, el botón Continuar se habilita", () => {
    setup();
    const continuar = screen.getByRole("button", { name: /Continuar/i });
    expect(continuar).toBeDisabled();

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);

    expect(continuar).not.toBeDisabled();
  });

  // DV-02: REGRESIÓN — click en el div contenedor también selecciona el ítem
  it("DV-02: hacer click en el div del producto también selecciona el ítem", () => {
    setup();
    const continuar = screen.getByRole("button", { name: /Continuar/i });

    // Clickear el texto del producto dentro del div clickeable
    fireEvent.click(screen.getByText("Alimento Premium 1kg"));

    expect(continuar).not.toBeDisabled();
  });

  // DV-03: checkbox refleja el estado seleccionado después del click
  it("DV-03: checkbox queda marcado después de seleccionar el ítem", () => {
    setup();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).not.toBeChecked();

    fireEvent.click(checkboxes[0]);

    expect(checkboxes[0]).toBeChecked();
  });

  // DV-04: segundo click en checkbox deselecciona el ítem
  it("DV-04: segundo click en checkbox deselecciona el ítem y deshabilita Continuar", () => {
    setup();
    const checkboxes = screen.getAllByRole("checkbox");
    const continuar = screen.getByRole("button", { name: /Continuar/i });

    fireEvent.click(checkboxes[0]);
    expect(continuar).not.toBeDisabled();
    expect(checkboxes[0]).toBeChecked();

    fireEvent.click(checkboxes[0]);
    expect(continuar).toBeDisabled();
    expect(checkboxes[0]).not.toBeChecked();
  });

  // DV-05: seleccionar múltiples ítems acumula el monto correctamente
  it("DV-05: seleccionar dos ítems muestra la suma de ambos montos", () => {
    setup();
    const checkboxes = screen.getAllByRole("checkbox");

    fireEvent.click(checkboxes[0]); // ITEM_1: 2 × $10.000 = $20.000
    fireEvent.click(checkboxes[1]); // ITEM_2: 1 × $5.000  = $5.000

    expect(screen.getByText(/Monto a devolver/i)).toBeInTheDocument();
    expect(screen.getByText("$25.000")).toBeInTheDocument();
  });

  // DV-06: campo cantidad aparece solo cuando el ítem está seleccionado
  it("DV-06: campo de cantidad aparece solo después de seleccionar el ítem", () => {
    setup();
    // El input type=number (spinbutton) no existe antes de seleccionar
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
  });

  // DV-07: sin selección el modal permanece en paso 1 con Continuar deshabilitado
  it("DV-07: sin seleccionar ítems el botón Continuar permanece deshabilitado", () => {
    setup();
    const continuar = screen.getByRole("button", { name: /Continuar/i });
    fireEvent.click(continuar); // click intencionado en botón deshabilitado
    // Sigue en paso 1 — título no cambia a "Paso 2"
    expect(screen.queryByText(/Paso 2/i)).not.toBeInTheDocument();
    expect(continuar).toBeDisabled();
  });

  // DV-08: modal no se renderiza cuando isOpen=false
  it("DV-08: cuando isOpen=false el modal no se muestra", () => {
    setup({ isOpen: false });
    expect(screen.queryByText(/Devolución/i)).not.toBeInTheDocument();
  });

  // DV-11: REGRESIÓN — con descuento 10%, monto a devolver es proporcional
  it("DV-11: con descuento 10%, el monto a devolver refleja el precio pagado", () => {
    setup({ descuento: 10 });
    // ITEM_1: 2 × $10.000 × 0.9 = $18.000
    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    expect(screen.getByText("$18.000")).toBeInTheDocument();
    expect(screen.queryByText("$20.000")).not.toBeInTheDocument();
  });

  // DV-12: sin descuento (0%), monto normal sin línea de descuento
  it("DV-12: con descuento 0%, el monto es el precio original completo", () => {
    setup({ descuento: 0 });
    // ITEM_1: 2 × $10.000 = $20.000
    fireEvent.click(screen.getByText("Alimento Premium 1kg"));
    // ITEM_2: 1 × $5.000 = $5.000
    fireEvent.click(screen.getByText("Juguete Pelota"));

    expect(screen.getByText("$25.000")).toBeInTheDocument();
  });

  // DV-13: con descuento, el precio por unidad muestra tachado + nuevo precio
  it("DV-13: con descuento 10%, el precio unitario se muestra tachado con el nuevo precio", () => {
    setup({ descuento: 10 });
    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    // El texto original $10.000 debe aparecer tachado y el nuevo $9.000 visible
    const priceTexts = screen.getAllByText(/c\/u/);
    expect(priceTexts[0]).toHaveTextContent("$9.000");
  });
});

describe("DevolucionModal — Paso 2: tipo de reembolso", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ numeroNc: "NC-20260624-XYZ99999", notaCreditoId: "nc-id-2" }),
    });
  });

  function selectItemAndAdvance() {
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  }

  // DV-09: avanzar a paso 2 después de seleccionar un ítem
  it("DV-09: tras seleccionar un ítem y clickear Continuar se muestra el paso 2", () => {
    setup();
    selectItemAndAdvance();
    expect(screen.getByText(/Paso 2/i)).toBeInTheDocument();
    expect(screen.getByText(/Tipo de reembolso/i)).toBeInTheDocument();
  });

  // DV-10: botón Confirmar llama al API y muestra pantalla de éxito
  it("DV-10: al confirmar la devolución se llama a /api/notas-credito y se muestra éxito", async () => {
    setup();
    selectItemAndAdvance();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar devolución/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/notas-credito",
        expect.objectContaining({ method: "POST" })
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/Devolución registrada/i)).toBeInTheDocument();
    });
  });
});
