/**
 * Tests MP-01 a MP-22: ModalPago
 * - MP-01 a MP-05: toggle "Enviar boleta por mail al cliente"
 * - MP-06 a MP-10: dropdown "Asignar a vendedor"
 * - MP-17 a MP-19: reset de método de pago al montar
 * - MP-21/MP-22: etiqueta "Descuento fidelización" vs. descuento manual
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSetEnviarEmailRecibo = jest.fn();
const mockSetMetodoPago        = jest.fn();
const mockSetDescuento         = jest.fn();
const mockSetProcedencia       = jest.fn();
const mockSetNumeroTransaccion = jest.fn();
const mockSetWorker            = jest.fn();
const mockSetPayNc             = jest.fn();
const mockClearPayNc           = jest.fn();

// Variables mutables — se leen en la factory cada vez que el componente llama usePOSStore()
let mockClienteEmail: string | undefined    = undefined;
let mockEnviarEmailRecibo                   = false;
let mockWorkerClerkId: string | undefined   = undefined;
let mockDescuento                           = 0;
let mockFidelizacionDescuento               = 0;
let mockSubtotalValue                       = 10000;
let mockMetodoPago                          = "efectivo";
let mockNumeroTransaccion: string | undefined = undefined;
let mockPagoNc: { nota_credito_id: string; numero_nc: string; monto: number } | undefined = undefined;

// ModalPago ahora destructura `items` y computa subtotal/total con las
// funciones puras reales de @/stores/pos (calcularSubtotalCarrito, etc.),
// no vía getters del store. Un único item sintético cuyo subtotal es
// mockSubtotalValue reproduce exactamente los mismos valores que antes
// exponían mockSubtotalValue/mockTotalValue por separado.
jest.mock("@/stores/pos", () => ({
  ...jest.requireActual("@/stores/pos"),
  usePOSStore: jest.fn(() => ({
    items: [{ id: "mock-item", producto_id: "p1", nombre: "Mock", precio: mockSubtotalValue, cantidad: 1, subtotal: mockSubtotalValue }],
    descuento:             mockDescuento,
    metodoPago:            mockMetodoPago,
    setMetodoPago:         mockSetMetodoPago,
    numeroTransaccion:     mockNumeroTransaccion,
    setNumeroTransaccion:  mockSetNumeroTransaccion,
    setDescuento:          mockSetDescuento,
    fidelizacionDescuento: mockFidelizacionDescuento,
    workerClerkId:         mockWorkerClerkId,
    setWorker:             mockSetWorker,
    procedencia:           "presencial",
    setProcedencia:        mockSetProcedencia,
    pagoNc:                mockPagoNc,
    setPayNc:              mockSetPayNc,
    clearPayNc:            mockClearPayNc,
    clienteEmail:          mockClienteEmail,
    enviarEmailRecibo:     mockEnviarEmailRecibo,
    setEnviarEmailRecibo:  mockSetEnviarEmailRecibo,
  })),
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog:        ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children, onClick, disabled,
  }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

// Workers endpoint — mutable por test
let mockWorkers: Array<{
  clerk_id: string; nombre: string | null; email: string;
  ventas_mes: number; ventas_hoy: number;
}> = [];

global.fetch = jest.fn().mockImplementation(() =>
  Promise.resolve({
    ok:   true,
    json: async () => mockWorkers,
  })
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function setup() {
  const onConfirm = jest.fn();
  const onCancel  = jest.fn();
  render(
    <ModalPago onConfirm={onConfirm} onCancel={onCancel} isLoading={false} />,
    { wrapper: makeWrapper() },
  );
  return { onConfirm, onCancel };
}

// ── Import después de mocks ───────────────────────────────────────────────────

import ModalPago from "@/app/(app)/pos/components/ModalPago";

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("ModalPago — toggle email al cliente", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClienteEmail      = undefined;
    mockEnviarEmailRecibo = false;
    mockDescuento         = 0;
    mockSubtotalValue     = 10000;
  });

  // MP-01
  it("MP-01: toggle NO se muestra cuando el cliente no tiene email", () => {
    // mockClienteEmail = undefined (default)
    setup();
    expect(screen.queryByText(/Enviar boleta por mail/)).not.toBeInTheDocument();
  });

  // MP-02
  it("MP-02: toggle SE muestra cuando el cliente tiene email", () => {
    mockClienteEmail = "juan@test.com";
    setup();
    expect(screen.getByText(/Enviar boleta por mail/)).toBeInTheDocument();
  });

  // MP-03
  it("MP-03: toggle aparece desactivado por defecto (muestra '○')", () => {
    mockClienteEmail      = "juan@test.com";
    mockEnviarEmailRecibo = false;
    setup();
    const btn = screen.getByText(/Enviar boleta por mail/).closest("button");
    expect(btn).toHaveTextContent("○");
  });

  // MP-04
  it("MP-04: al hacer click llama setEnviarEmailRecibo(true) cuando está desactivado", () => {
    mockClienteEmail      = "juan@test.com";
    mockEnviarEmailRecibo = false;
    setup();
    fireEvent.click(screen.getByText(/Enviar boleta por mail/).closest("button")!);
    expect(mockSetEnviarEmailRecibo).toHaveBeenCalledWith(true);
  });

  // MP-05
  it("MP-05: cuando enviarEmailRecibo=true muestra '✓' y llama setEnviarEmailRecibo(false) al hacer click", () => {
    mockClienteEmail      = "juan@test.com";
    mockEnviarEmailRecibo = true;
    setup();
    const btn = screen.getByText(/Enviar boleta por mail/).closest("button")!;
    expect(btn).toHaveTextContent("✓");
    fireEvent.click(btn);
    expect(mockSetEnviarEmailRecibo).toHaveBeenCalledWith(false);
  });
});

// ── Asignar a vendedor ────────────────────────────────────────────────────────

const WORKER_ACTUAL = { clerk_id: "user-actual", nombre: "Carlos Pérez", email: "carlos@test.com", ventas_mes: 5, ventas_hoy: 1 };
const WORKER_OTRO   = { clerk_id: "user-otro",   nombre: "Ana López",   email: "ana@test.com",    ventas_mes: 3, ventas_hoy: 0 };

describe("ModalPago — dropdown Asignar a vendedor (MP-06/MP-07/MP-08/MP-09)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClienteEmail      = undefined;
    mockEnviarEmailRecibo = false;
    mockWorkerClerkId     = undefined;
    mockWorkers           = [];
    mockDescuento         = 0;
    mockSubtotalValue     = 10000;
  });

  // MP-06
  it("MP-06: dropdown se muestra cuando hay workers disponibles", async () => {
    mockWorkers = [WORKER_ACTUAL];
    setup();
    expect(await screen.findByText("Asignar a vendedor")).toBeInTheDocument();
  });

  // MP-07
  it("MP-07: worker pre-seleccionado cuando workerClerkId coincide", async () => {
    mockWorkerClerkId = "user-actual";
    mockWorkers = [WORKER_ACTUAL, WORKER_OTRO];
    setup();
    const select = (await screen.findByDisplayValue("Carlos Pérez")) as HTMLSelectElement;
    expect(select.value).toBe("user-actual");
  });

  // MP-08
  it("MP-08: cambiar selección llama setWorker con el clerk_id elegido", async () => {
    mockWorkers = [WORKER_ACTUAL, WORKER_OTRO];
    setup();
    const select = (await screen.findByDisplayValue("Sin asignar")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "user-otro" } });
    expect(mockSetWorker).toHaveBeenCalledWith("user-otro");
  });

  // MP-09
  it("MP-09: sin workerClerkId el select muestra 'Sin asignar'", async () => {
    mockWorkers = [WORKER_ACTUAL];
    setup();
    const select = (await screen.findByDisplayValue("Sin asignar")) as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  // MP-10
  it("MP-10: al seleccionar 'Sin asignar' llama setWorker(undefined)", async () => {
    mockWorkerClerkId = "user-actual";
    mockWorkers = [WORKER_ACTUAL];
    setup();
    const select = (await screen.findByDisplayValue("Carlos Pérez")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "" } });
    expect(mockSetWorker).toHaveBeenCalledWith(undefined);
  });

  // MP-16
  it("MP-16: muestra skeleton mientras carga workers y luego el select", async () => {
    let resolveWorkerFetch: (v: unknown) => void;
    const deferred = new Promise((resolve) => { resolveWorkerFetch = resolve; });
    (global.fetch as jest.Mock).mockImplementationOnce(
      () => deferred.then(() => ({ ok: true, json: async () => [WORKER_ACTUAL] })),
    );
    mockWorkers = [WORKER_ACTUAL];
    setup();

    // During loading — skeleton reserva espacio
    expect(screen.getByTestId("worker-skeleton")).toBeInTheDocument();

    // Resolve fetch
    resolveWorkerFetch!(undefined);

    // After loading — select replaces skeleton
    await waitFor(() => {
      expect(screen.queryByTestId("worker-skeleton")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Asignar a vendedor")).toBeInTheDocument();
  });
});

// ── IVA breakdown — regresión ticket de venta ─────────────────────────────────

describe("ModalPago — IVA breakdown correcto (MP-11/MP-12)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClienteEmail      = undefined;
    mockEnviarEmailRecibo = false;
    mockWorkerClerkId     = undefined;
    mockWorkers           = [];
    mockDescuento         = 0;
    mockSubtotalValue     = 10000;
  });

  // MP-11: sin descuento muestra "Neto (sin IVA)" y no muestra "Subtotal" duplicado igual al total
  it("MP-11: sin descuento muestra 'Neto (sin IVA)' y no muestra 'Subtotal'", () => {
    // subtotal=10000 (IVA-incl), total=10000, ivaAmount=round(10000*0.19/1.19)=1597, neto=8403
    mockSubtotalValue = 10000;
    mockDescuento     = 0;
    setup();
    expect(screen.getByText("Neto (sin IVA)")).toBeInTheDocument();
    expect(screen.queryByText("Subtotal")).not.toBeInTheDocument();
  });

  // MP-12: con descuento muestra "Subtotal", "Descuento" y "Neto (sin IVA)"
  it("MP-12: con descuento muestra 'Subtotal', 'Descuento' y 'Neto (sin IVA)'", () => {
    // subtotal=10000, 10% desc → total=9000
    mockSubtotalValue = 10000;
    mockDescuento     = 10;
    setup();
    expect(screen.getByText("Subtotal")).toBeInTheDocument();
    expect(screen.getByText(/Descuento \(10%\)/)).toBeInTheDocument();
    expect(screen.getByText("Neto (sin IVA)")).toBeInTheDocument();
    expect(screen.getByText("IVA (19%)")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });
});

describe("ModalPago — número de transacción (MP-13 a MP-15)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMetodoPago         = "efectivo";
    mockNumeroTransaccion  = undefined;
    mockSubtotalValue      = 10000;
    mockDescuento          = 0;
    mockClienteEmail       = undefined;
    mockEnviarEmailRecibo  = false;
    mockWorkerClerkId      = undefined;
  });

  // MP-13
  it("MP-13: debito muestra label N° transacción con asterisco rojo", () => {
    mockMetodoPago = "debito";
    setup();
    const label = screen.getByText(/Número de transacción/);
    expect(label).toBeInTheDocument();
    expect(label.innerHTML).toContain("*");
  });

  // MP-14
  it("MP-14: efectivo no muestra el campo N° transacción", () => {
    mockMetodoPago = "efectivo";
    setup();
    expect(screen.queryByText(/Número de transacción/)).not.toBeInTheDocument();
  });

  // MP-15
  it("MP-15: credito con TRX vacío en blur muestra error obligatorio", () => {
    mockMetodoPago        = "credito";
    mockNumeroTransaccion = "";
    setup();
    const input = screen.getByPlaceholderText("Ej: TRX123456789");
    fireEvent.blur(input);
    expect(screen.getByText("Campo obligatorio para pagos con débito/crédito/transferencia")).toBeInTheDocument();
  });
});

// ── Reset de método de pago al montar — REGRESIÓN ticket Trello 6a619fafd0aa9aa5ad06b1dd ──
//
// El modal se abría con metodoPago="nota_credito" y pagoNc ya seteado, heredado de
// localStorage de una venta anterior interrumpida a mitad de un pago mixto con NC
// (root cause corregido en src/stores/pos.ts — metodoPago/numeroTransaccion/pagoNc
// ya no se persisten, ver S-43/S-44 en tests/unit/lib/pos-store.test.ts). Estos tests
// cubren la segunda capa: aunque el estado en memoria/localStorage YA esté "sucio"
// (blobs guardados por una versión anterior de la app, antes del fix de pos.ts, o un
// Cancelar sin limpiar dentro de la misma sesión), ModalPago debe arrancar en un
// estado neutro cada vez que se monta.
describe("ModalPago — reset de método de pago al montar (MP-17 a MP-19)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClienteEmail      = undefined;
    mockEnviarEmailRecibo = false;
    mockWorkerClerkId     = undefined;
    mockWorkers           = [];
    mockDescuento         = 0;
    mockSubtotalValue     = 10000;
    mockNumeroTransaccion = undefined;
  });

  // MP-17
  it("MP-17: REGRESIÓN — abre con NC heredado (metodoPago='nota_credito' + pagoNc seteado) → resetea a efectivo y limpia pagoNc", () => {
    mockMetodoPago = "nota_credito";
    mockPagoNc = { nota_credito_id: "nc-1", numero_nc: "NC-VIEJA", monto: 5000 };
    setup();
    expect(mockSetMetodoPago).toHaveBeenCalledWith("efectivo");
    expect(mockClearPayNc).toHaveBeenCalled();
  });

  // MP-18: caso ya cubierto antes del ticket (metodoPago vacío) — no debe dejar de funcionar
  it("MP-18: metodoPago vacío (undefined) se inicializa a efectivo", () => {
    mockMetodoPago = undefined as unknown as string;
    mockPagoNc = undefined;
    setup();
    expect(mockSetMetodoPago).toHaveBeenCalledWith("efectivo");
  });

  // MP-19: caso normal — sin nada heredado, no debe disparar sets innecesarios
  it("MP-19: metodoPago ya 'efectivo' sin pagoNc → no llama setMetodoPago ni clearPayNc", () => {
    mockMetodoPago = "efectivo";
    mockPagoNc = undefined;
    setup();
    expect(mockSetMetodoPago).not.toHaveBeenCalled();
    expect(mockClearPayNc).not.toHaveBeenCalled();
  });
});

// ── Etiqueta "Descuento fidelización" — MEJORA ticket Trello 6a62eb2efd10640e778299af ──
//
// El descuento auto-aplicado al seleccionar cliente (BUG-04, ya corregido) usaba
// la etiqueta genérica "Descuento (X%)", igual que un descuento manual — el
// cajero y el cliente no podían distinguir por qué se aplicó. La etiqueta ahora
// dice "Descuento fidelización (X%)" solo mientras el descuento activo siga
// siendo igual al nivel de fidelización del cliente; si el vendedor lo edita
// manualmente (input libre o DESCUENTOS_RAPIDOS), vuelve a la etiqueta genérica.
describe("ModalPago — etiqueta de descuento por fidelización (MP-21/MP-22)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClienteEmail          = undefined;
    mockEnviarEmailRecibo     = false;
    mockDescuento             = 0;
    mockFidelizacionDescuento = 0;
    mockSubtotalValue         = 10000;
  });

  // MP-21
  it("MP-21: descuento activo igual al nivel de fidelización → etiqueta 'Descuento fidelización (X%)'", () => {
    mockDescuento             = 10;
    mockFidelizacionDescuento = 10;
    setup();
    expect(screen.getByText("Descuento fidelización (10%)")).toBeInTheDocument();
  });

  // MP-22
  it("MP-22: descuento editado manualmente (distinto al nivel de fidelización) → etiqueta genérica 'Descuento (X%)'", () => {
    mockDescuento             = 15; // el vendedor lo subió con DESCUENTOS_RAPIDOS o el input libre
    mockFidelizacionDescuento = 10; // el cliente sigue teniendo 10% de fidelización
    setup();
    expect(screen.getByText("Descuento (15%)")).toBeInTheDocument();
    expect(screen.queryByText(/Descuento fidelización/)).not.toBeInTheDocument();
  });

  it("MP-22b: sin cliente con fidelización (fidelizacionDescuento=0) y descuento manual → etiqueta genérica", () => {
    mockDescuento             = 10;
    mockFidelizacionDescuento = 0;
    setup();
    expect(screen.getByText("Descuento (10%)")).toBeInTheDocument();
    expect(screen.queryByText(/Descuento fidelización/)).not.toBeInTheDocument();
  });
});
