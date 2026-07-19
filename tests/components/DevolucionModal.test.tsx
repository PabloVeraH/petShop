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
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
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

  // DV-15: REGRESIÓN — motivo completo se envía en el body, no truncado por focus steal
  it("DV-15: el motivo completo con acentos se envía en el body del fetch", async () => {
    setup();
    selectItemAndAdvance();

    const motivoInput = screen.getByPlaceholderText(/Producto defectuoso/i);
    fireEvent.change(motivoInput, { target: { value: "QA test - devolución Arena Arenero" } });

    fireEvent.click(screen.getByRole("button", { name: /Confirmar devolución/i }));

    await waitFor(() => {
      expect(screen.getByText(/Devolución registrada/i)).toBeInTheDocument();
    });

    const fetchCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url]: [string]) => url === "/api/notas-credito"
    );
    expect(fetchCall).toBeDefined();
    const body = JSON.parse(fetchCall![1].body);
    expect(body.motivo).toBe("QA test - devolución Arena Arenero");
  });

  // DV-16: REGRESIÓN — motivo vacío se envía como null
  it("DV-16: motivo vacío se envía como null en el body", async () => {
    setup();
    selectItemAndAdvance();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar devolución/i }));

    await waitFor(() => {
      expect(screen.getByText(/Devolución registrada/i)).toBeInTheDocument();
    });

    const fetchCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url]: [string]) => url === "/api/notas-credito"
    );
    expect(fetchCall).toBeDefined();
    const body = JSON.parse(fetchCall![1].body);
    expect(body.motivo).toBeNull();
  });

  // DV-17: REGRESIÓN — escribir en Motivo no vuelve a robar el foco del
  // ModalOverlay real (no mockeado en este archivo). DV-15 solo prueba que
  // el valor final llega íntegro al fetch con un solo fireEvent.change (todo
  // el texto de una vez), lo cual nunca ejercita el mecanismo real del bug:
  // cada keystroke dispara onChange → setMotivo → re-render → resetForm (no
  // memoizado) obtiene una referencia nueva → ModalOverlay recibe un onClose
  // nuevo. Antes del fix (commit 1270b13), el efecto de foco de ModalOverlay
  // dependía de [open, onClose], así que esa referencia nueva lo hacía
  // volver a llamar ref.current?.focus() en cada keystroke, robando el foco
  // del input Motivo. Este test verifica el mecanismo real: que escribir no
  // dispara un nuevo focus() del overlay tras el que ya ocurrió al abrir.
  it("DV-17: REGRESIÓN — escribir en Motivo no vuelve a robar el foco del ModalOverlay", async () => {
    const focusSpy = jest.spyOn(HTMLElement.prototype, "focus");
    setup();
    selectItemAndAdvance();
    const llamadasAlAbrir = focusSpy.mock.calls.length;
    expect(llamadasAlAbrir).toBeGreaterThan(0);

    const motivoInput = screen.getByPlaceholderText(/Producto defectuoso/i);
    fireEvent.change(motivoInput, { target: { value: "QA test - devolución Arena Arenero" } });

    expect(motivoInput).toHaveValue("QA test - devolución Arena Arenero");
    expect(focusSpy).toHaveBeenCalledTimes(llamadasAlAbrir);

    focusSpy.mockRestore();
  });

  // DV-14: REGRESIÓN — confirmar devolución invalida ["ventas"] con refetchType "all"
  it("DV-14: REGRESIÓN — devolución invalida ['ventas'] con refetchType 'all'", async () => {
    setup();
    selectItemAndAdvance();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar devolución/i }));

    await waitFor(() => {
      expect(screen.getByText(/Devolución registrada/i)).toBeInTheDocument();
    });

    // Debe invalidar el detalle de la venta, con refetchType "all" (el
    // detalle puede estar desmontado si la devolución se disparó desde otra
    // vista — mismo patrón que VT-03/IV-04/CT-04/LP-04).
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["venta", "venta-test-123"], refetchType: "all" });
    // Debe invalidar el listado con refetchType "all"
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["ventas"], refetchType: "all" });
    // También debe invalidar queries relacionadas, también con refetchType "all"
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["notas-credito", "venta-test-123"], refetchType: "all" });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["saldo", "cliente-1"], refetchType: "all" });
    // NO debe llamar ninguna de las cuatro sin refetchType (versión bugueada)
    expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["ventas"] });
    expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["venta", "venta-test-123"] });
    expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["notas-credito", "venta-test-123"] });
    expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["saldo", "cliente-1"] });
  });
});
