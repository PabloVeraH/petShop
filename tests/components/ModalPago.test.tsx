/**
 * Tests MP-01 a MP-22: ModalPago
 * - MP-01 a MP-05: toggle "Enviar comprobante por mail al cliente"
 * - MP-13 a MP-15: número de transacción por fila (SelectorPagos)
 * - MP-26 a MP-31: pago mixto (pagos[] al confirmar, resto, aviso de boleta)
 * - MP-06 a MP-10: dropdown "Asignar a vendedor"
 * - MP-17 a MP-19: reset de método de pago al montar
 * - MP-21/MP-22: etiqueta "Descuento fidelización" vs. descuento manual
 * - MP-23: validación de longitud mínima en Notas internas
 * - MP-24/MP-25: alerta de vendedor sin seleccionar
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSetEnviarEmailRecibo = jest.fn();
const mockSetDescuento         = jest.fn();
const mockSetProcedencia       = jest.fn();
const mockSetWorker            = jest.fn();
const mockSetNotas             = jest.fn();

// Variables mutables — se leen en la factory cada vez que el componente llama usePOSStore()
let mockClienteEmail: string | undefined    = undefined;
let mockEnviarEmailRecibo                   = false;
let mockWorkerClerkId: string | undefined   = undefined;
let mockDescuento                           = 0;
let mockFidelizacionDescuento               = 0;
let mockSubtotalValue                       = 10000;
let mockNotas                               = "";
let mockClienteId: string | undefined       = undefined;
// Estado de cobro de una versión ANTERIOR del store (blob viejo de
// localStorage rehidratado): el modal debe ignorarlo (MP-17).
let mockEstadoLegado: Record<string, unknown> = {};

// ModalPago ahora destructura `items` y computa subtotal/total con las
// funciones puras reales de @/stores/pos (calcularSubtotalCarrito, etc.),
// no vía getters del store. Un único item sintético cuyo subtotal es
// mockSubtotalValue reproduce exactamente los mismos valores que antes
// exponían mockSubtotalValue/mockTotalValue por separado.
jest.mock("@/stores/pos", () => ({
  ...jest.requireActual("@/stores/pos"),
  usePOSStore: jest.fn(() => ({
    items: [{ id: "mock-item", producto_id: "p1", nombre: "Mock", precio: mockSubtotalValue, cantidad: 1, subtotal: mockSubtotalValue }],
    ...mockEstadoLegado,
    descuento:             mockDescuento,
    clienteId:             mockClienteId,
    setDescuento:          mockSetDescuento,
    fidelizacionDescuento: mockFidelizacionDescuento,
    workerClerkId:         mockWorkerClerkId,
    setWorker:             mockSetWorker,
    procedencia:           "presencial",
    setProcedencia:        mockSetProcedencia,
    clienteEmail:          mockClienteEmail,
    enviarEmailRecibo:     mockEnviarEmailRecibo,
    setEnviarEmailRecibo:  mockSetEnviarEmailRecibo,
    notas:                 mockNotas,
    setNotas:              mockSetNotas,
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

// Workers. El flujo de NC y saldo a favor se prueba en SelectorPagos.test.tsx.
global.fetch = jest.fn().mockImplementation(() =>
  Promise.resolve({ ok: true, json: async () => mockWorkers })
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function setup(props: { umbralIdentificacion?: number | null } = {}) {
  const onConfirm = jest.fn();
  const onCancel  = jest.fn();
  const utils = render(
    <ModalPago onConfirm={onConfirm} onCancel={onCancel} isLoading={false} {...props} />,
    { wrapper: makeWrapper() },
  );
  return { onConfirm, onCancel, ...utils };
}

const cobrar = () => screen.getByRole("button", { name: /^Cobrar/ });
const metodo = (i: number) => screen.getByLabelText(`Método del pago ${i}`);
const monto = (i: number) => screen.getByLabelText(`Monto del pago ${i}`);

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
    expect(screen.queryByText(/Enviar comprobante por mail/)).not.toBeInTheDocument();
  });

  // MP-02
  it("MP-02: toggle SE muestra cuando el cliente tiene email", () => {
    mockClienteEmail = "juan@test.com";
    setup();
    // D12: lo que se envía es un comprobante, no una boleta (no es documento tributario).
    expect(screen.getByText(/Enviar comprobante por mail/)).toBeInTheDocument();
    expect(screen.queryByText(/Enviar boleta/)).not.toBeInTheDocument();
  });

  // MP-03
  it("MP-03: toggle aparece desactivado por defecto (muestra '○')", () => {
    mockClienteEmail      = "juan@test.com";
    mockEnviarEmailRecibo = false;
    setup();
    const btn = screen.getByText(/Enviar comprobante por mail/).closest("button");
    expect(btn).toHaveTextContent("○");
  });

  // MP-04
  it("MP-04: al hacer click llama setEnviarEmailRecibo(true) cuando está desactivado", () => {
    mockClienteEmail      = "juan@test.com";
    mockEnviarEmailRecibo = false;
    setup();
    fireEvent.click(screen.getByText(/Enviar comprobante por mail/).closest("button")!);
    expect(mockSetEnviarEmailRecibo).toHaveBeenCalledWith(true);
  });

  // MP-05
  it("MP-05: cuando enviarEmailRecibo=true muestra '✓' y llama setEnviarEmailRecibo(false) al hacer click", () => {
    mockClienteEmail      = "juan@test.com";
    mockEnviarEmailRecibo = true;
    setup();
    const btn = screen.getByText(/Enviar comprobante por mail/).closest("button")!;
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
    mockSubtotalValue      = 10000;
    mockDescuento          = 0;
    mockClienteEmail       = undefined;
    mockEnviarEmailRecibo  = false;
    mockWorkerClerkId      = undefined;
    mockClienteId          = undefined;
    mockEstadoLegado       = {};
  });

  // MP-13 (pago mixto: el TRX es por fila)
  it("MP-13: débito muestra el campo de N° de transacción marcado como obligatorio", () => {
    setup();
    fireEvent.change(metodo(1), { target: { value: "debito" } });
    expect(screen.getByLabelText("N° de transacción del pago 1")).toHaveAttribute("placeholder", "N° de transacción (obligatorio)");
  });

  // MP-14
  it("MP-14: efectivo no muestra el campo N° de transacción", () => {
    setup();
    expect(screen.queryByLabelText(/N° de transacción/)).not.toBeInTheDocument();
  });

  // MP-15
  it("MP-15: crédito sin TRX bloquea Cobrar y muestra el motivo; con TRX se habilita", () => {
    setup();
    fireEvent.change(metodo(1), { target: { value: "credito" } });
    expect(cobrar()).toBeDisabled();
    expect(screen.getByTestId("error-pago")).toHaveTextContent(/número de transacción es obligatorio/);
    fireEvent.change(screen.getByLabelText("N° de transacción del pago 1"), { target: { value: "TRX-1" } });
    expect(cobrar()).not.toBeDisabled();
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
// Desde el pago mixto (F7) el estado del cobro es local al modal: cada
// apertura arranca neutra por construcción, aunque el store traiga estado de
// cobro de un blob viejo de localStorage.
describe("ModalPago — estado neutro al montar (MP-17 a MP-19)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClienteEmail      = undefined;
    mockEnviarEmailRecibo = false;
    mockWorkerClerkId     = undefined;
    mockWorkers           = [];
    mockDescuento         = 0;
    mockSubtotalValue     = 10000;
    mockClienteId         = undefined;
    mockEstadoLegado      = {};
  });

  // MP-17
  it("MP-17: REGRESIÓN — un store con NC heredada (blob viejo: metodoPago='nota_credito' + pagoNc) abre igual con un pago en efectivo por el total", () => {
    mockEstadoLegado = {
      metodoPago: "nota_credito",
      pagoNc: { nota_credito_id: "nc-1", numero_nc: "NC-VIEJA", monto: 5000 },
      numeroTransaccion: "TRX-VIEJO",
    };
    setup();
    expect(screen.getAllByTestId(/^fila-pago-/)).toHaveLength(1);
    expect(metodo(1)).toHaveValue("efectivo");
    expect(monto(1)).toHaveValue(10000);
    expect(screen.queryByText(/NC-VIEJA/)).not.toBeInTheDocument();
    expect(cobrar()).not.toBeDisabled();
  });

  // MP-18
  it("MP-18: apertura normal → un pago en efectivo por el total y 'Total cubierto'", () => {
    setup();
    expect(metodo(1)).toHaveValue("efectivo");
    expect(monto(1)).toHaveValue(10000);
    expect(screen.getByTestId("resto-pago")).toHaveTextContent("Total cubierto");
  });

  // MP-19: Cancelar a mitad de un cobro mixto y reabrir no hereda nada.
  it("MP-19: cerrar a mitad de un cobro mixto y reabrir → vuelve a un solo pago en efectivo", () => {
    const { unmount } = setup();
    // Con todo el total en un pago no hay "Agregar": primero se baja el monto.
    expect(screen.queryByText("+ Agregar medio de pago")).not.toBeInTheDocument();
    fireEvent.change(monto(1), { target: { value: "4000" } });
    fireEvent.click(screen.getByText("+ Agregar medio de pago"));
    expect(screen.getAllByTestId(/^fila-pago-/)).toHaveLength(2);
    unmount();

    setup();
    expect(screen.getAllByTestId(/^fila-pago-/)).toHaveLength(1);
    expect(monto(1)).toHaveValue(10000);
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

// ── Validación de longitud mínima en Notas internas — MEJORA ticket Trello 6a62eb3057bc5972b4ca8dcc ──
describe("ModalPago — validación de longitud mínima en Notas internas (MP-23)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClienteEmail  = undefined;
    mockDescuento     = 0;
    mockSubtotalValue = 10000;
    mockNotas         = "";
  });

  it("MP-23: Notas internas con menos de 5 caracteres muestra error y bloquea Cobrar", () => {
    mockNotas = "ab";
    setup();
    expect(screen.getByText(/Las notas deben tener al menos 5 caracteres/i)).toBeInTheDocument();
    expect(screen.getByText(/Cobrar \$/)).toBeDisabled();
  });

  it("MP-23b: Notas internas con 5 o más caracteres no muestra error", () => {
    mockNotas = "abcde";
    setup();
    expect(screen.queryByText(/Las notas deben tener al menos 5 caracteres/i)).not.toBeInTheDocument();
  });
});

// MEJORA (ticket Trello 6a62eb34f2869126d5e8bb30): el auto-asignado del
// vendedor logueado (pos/page.tsx, fix previo commit 0d6fd91) y la reasignación
// manual (MP-06 a MP-10) ya existían, pero no había ninguna advertencia cuando
// no hay vendedor seleccionado — ni con "Sin asignar" elegido a propósito, ni
// cuando el store no tiene workers cargados. El texto de la alerta NO afirma
// que la venta queda sin atribuir en la BD: verificado en route.ts que el
// backend siempre usa ctx.userId como fallback (p_worker_clerk_id: workerClerkId
// ?? ctx.userId), así que worker_clerk_id nunca queda NULL.
describe("ModalPago — alerta de venta sin vendedor asignado (MP-24/MP-25)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClienteEmail  = undefined;
    mockDescuento     = 0;
    mockSubtotalValue = 10000;
    mockWorkerClerkId = undefined;
    mockWorkers       = [];
  });

  it("MP-24: workerClerkId vacío muestra la alerta de vendedor sin seleccionar", async () => {
    mockWorkerClerkId = undefined;
    mockWorkers = [WORKER_ACTUAL];
    setup();
    expect(await screen.findByText(/No hay un vendedor seleccionado para esta venta/i)).toBeInTheDocument();
  });

  it("MP-24b: la alerta se muestra también sin workers registrados en la tienda (dropdown ni siquiera se renderiza)", async () => {
    mockWorkerClerkId = undefined;
    mockWorkers = [];
    setup();
    expect(screen.getByText(/No hay un vendedor seleccionado para esta venta/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Asignar a vendedor")).not.toBeInTheDocument();
    });
  });

  it("MP-25: workerClerkId asignado NO muestra la alerta", async () => {
    mockWorkerClerkId = "user-actual";
    mockWorkers = [WORKER_ACTUAL];
    setup();
    await screen.findByText("Asignar a vendedor");
    expect(screen.queryByText(/No hay un vendedor seleccionado para esta venta/i)).not.toBeInTheDocument();
  });

  it("MP-25b: al cambiar de 'Sin asignar' a un vendedor, deja de mostrarse la alerta", async () => {
    mockWorkers = [WORKER_ACTUAL];
    const { rerender } = (() => {
      const onConfirm = jest.fn();
      const onCancel = jest.fn();
      const utils = render(
        <ModalPago onConfirm={onConfirm} onCancel={onCancel} isLoading={false} />,
        { wrapper: makeWrapper() },
      );
      return { rerender: utils.rerender };
    })();
    expect(await screen.findByText(/No hay un vendedor seleccionado para esta venta/i)).toBeInTheDocument();

    mockWorkerClerkId = "user-actual";
    rerender(<ModalPago onConfirm={jest.fn()} onCancel={jest.fn()} isLoading={false} />);
    await waitFor(() => {
      expect(screen.queryByText(/No hay un vendedor seleccionado para esta venta/i)).not.toBeInTheDocument();
    });
  });
});

// ── Pago mixto (MP-26 a MP-31) — docs/plan_pago_mixto.md F7 ───────────────────
describe("ModalPago — pago mixto (MP-26 a MP-31)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClienteEmail      = undefined;
    mockEnviarEmailRecibo = false;
    mockWorkerClerkId     = "user-actual";
    mockWorkers           = [];
    mockDescuento         = 0;
    mockSubtotalValue     = 10000;
    mockClienteId         = undefined;
    mockEstadoLegado      = {};
  });

  function dividirEfectivoDebito() {
    fireEvent.change(monto(1), { target: { value: "4000" } });
    fireEvent.click(screen.getByText("+ Agregar medio de pago"));
    fireEvent.change(metodo(2), { target: { value: "debito" } });
    fireEvent.change(screen.getByLabelText("N° de transacción del pago 2"), { target: { value: " TRX-77 " } });
  }

  it("MP-26: Cobrar envía los pagos elegidos (efectivo $4.000 + débito $6.000 con TRX)", () => {
    const { onConfirm } = setup();
    dividirEfectivoDebito();
    expect(monto(2)).toHaveValue(6000); // la fila nueva propone el resto
    fireEvent.click(cobrar());
    expect(onConfirm).toHaveBeenCalledWith([
      { metodo: "efectivo", monto: 4000 },
      { metodo: "debito", monto: 6000, numeroTransaccion: "TRX-77" },
    ]);
  });

  it("MP-27: con resto distinto de 0 Cobrar queda deshabilitado y se informa cuánto falta o sobra", () => {
    const { onConfirm } = setup();
    fireEvent.change(monto(1), { target: { value: "7000" } });
    expect(screen.getByTestId("resto-pago")).toHaveTextContent("Falta $3.000");
    expect(cobrar()).toBeDisabled();
    fireEvent.change(monto(1), { target: { value: "12000" } });
    expect(screen.getByTestId("resto-pago")).toHaveTextContent("Sobra $2.000");
    fireEvent.click(cobrar());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("MP-28: aviso de boleta (Res. 176): solo efectivo/transferencia/crédito interno; 100 % tarjeta → voucher cubre", () => {
    setup();
    dividirEfectivoDebito();
    expect(screen.getByTestId("aviso-boleta")).toHaveTextContent("Emitir boleta SII por $4.000");
    expect(screen.getByTestId("aviso-boleta")).toHaveTextContent("Efectivo $4.000");
    expect(screen.getByTestId("aviso-boleta")).not.toHaveTextContent("Débito");

    fireEvent.click(screen.getByLabelText("Quitar pago 1"));
    fireEvent.change(monto(1), { target: { value: "10000" } });
    expect(screen.getByTestId("aviso-boleta")).toHaveTextContent("El voucher Transbank cubre el total");
  });

  it("MP-29: si cambia el total (descuento) y había un solo pago por el total, el pago lo sigue", () => {
    const { rerender } = setup();
    expect(monto(1)).toHaveValue(10000);
    mockDescuento = 10;
    rerender(<ModalPago onConfirm={jest.fn()} onCancel={jest.fn()} isLoading={false} />);
    expect(monto(1)).toHaveValue(9000);
    expect(cobrar()).toHaveTextContent("Cobrar $9.000");
    expect(cobrar()).not.toBeDisabled();
  });

  it("MP-30: aviso 135 UF solo cuando el total supera el umbral configurado (no bloquea)", () => {
    const { unmount } = setup({ umbralIdentificacion: 5000 });
    expect(screen.getByTestId("aviso-135uf")).toHaveTextContent("nombre y RUT");
    expect(cobrar()).not.toBeDisabled();
    unmount();
    setup({ umbralIdentificacion: null });
    expect(screen.queryByTestId("aviso-135uf")).not.toBeInTheDocument();
  });

  it("MP-31: 'Saldo a favor' no se puede elegir sin cliente (conveniencia de UX; el control real es del servidor, I-793)", () => {
    setup();
    const opcion = Array.from((metodo(1) as HTMLSelectElement).options).find((o) => o.value === "saldo_a_favor")!;
    expect(opcion.disabled).toBe(true);
  });
});
