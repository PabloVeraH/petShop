/**
 * Tests COB-01 a COB-10: ModalCobroCita — modal de cobro de cita.
 * Desde el pago mixto (docs/plan_pago_mixto.md F8) usa el SelectorPagos
 * compartido con el POS y envía {accion: "completar", pagos}. Mismos escenarios
 * que antes (COB-01…08) más el cobro con varios medios (COB-09, COB-10).
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/components/ui/button", () => ({
  Button: function Button({ children, onClick, disabled, variant, size, className }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: string; size?: string; className?: string;
  }) {
    return <button onClick={onClick} disabled={disabled} data-variant={variant} data-size={size} className={className}>{children}</button>;
  },
}));

jest.mock("@/components/ui/modal-overlay", () => ({
  ModalOverlay: function ModalOverlay({ open, children }: { open: boolean; children: ReactNode }) {
    return open ? <div data-testid="modal-overlay">{children}</div> : null;
  },
}));

import ModalCobroCita from "@/app/(app)/citas/components/ModalCobroCita";

const CITA = {
  id: "cita-1",
  precio: 15000,
  cliente_id: "cli-1",
  servicio: { nombre: "Peluquería" },
} as const;

const NC_MOCK = {
  data: {
    id: "nc-1",
    numero_nc: "NC-20260805-ABC123",
    monto_total: 15000,
    monto_disponible: 15000,
    fecha_vencimiento: "2026-12-31",
  },
};

function mockFetchDefaultImpl(url: string) {
  if (url.startsWith("/api/notas-credito")) return Promise.resolve({ ok: true, json: async () => NC_MOCK });
  if (url.startsWith("/api/saldos-a-favor")) return Promise.resolve({ ok: true, json: async () => ({ saldo_disponible: 5000 }) });
  if (url.startsWith("/api/citas/")) return Promise.resolve({ ok: true, json: async () => ({ id: CITA.id, estado: "completada" }) });
  return Promise.resolve({ ok: true, json: async () => ({}) });
}

function renderModal() {
  const onClose = jest.fn();
  const onSuccess = jest.fn();
  render(<ModalCobroCita cita={CITA as never} onClose={onClose} onSuccess={onSuccess} />);
  return { onClose, onSuccess };
}

const cobrar = () => screen.getByText("Cobrar $15.000");
const metodo = (i: number) => screen.getByLabelText(`Método del pago ${i}`);
const monto = (i: number) => screen.getByLabelText(`Monto del pago ${i}`);
const bodyPatch = () => {
  const call = mockFetch.mock.calls.find(([url]) => String(url).startsWith("/api/citas/"));
  return call ? JSON.parse(call[1].body) : undefined;
};

async function validarNc(codigo: string) {
  fireEvent.change(metodo(1), { target: { value: "nota_credito" } });
  fireEvent.change(screen.getByLabelText("Código de la nota de crédito"), { target: { value: codigo } });
  fireEvent.click(screen.getByText("Validar"));
}

describe("ModalCobroCita (COB-XX)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockImplementation(mockFetchDefaultImpl);
  });

  // COB-01
  it("COB-01: muestra el desglose neto/IVA/total derivado del precio bruto", () => {
    renderModal();
    expect(screen.getByText("Cobrar cita")).toBeInTheDocument();
    expect(screen.getByText("$15.000")).toBeInTheDocument(); // Total (bruto)
    expect(screen.getByText("$12.605")).toBeInTheDocument(); // Neto = 15000 - 2395
    expect(screen.getByText("$2.395")).toBeInTheDocument(); // IVA extraído (tax.ts)
    expect(screen.getByText("Peluquería")).toBeInTheDocument();
  });

  // COB-02
  it("COB-02: con efectivo (default) 'Cobrar' dispara PATCH completar con un pago en efectivo por el total", async () => {
    const { onSuccess } = renderModal();
    fireEvent.click(cobrar());

    await waitFor(() => expect(bodyPatch()).toEqual({ accion: "completar", pagos: [{ metodo: "efectivo", monto: 15000 }] }));
    expect(mockFetch).toHaveBeenCalledWith("/api/citas/cita-1", expect.objectContaining({ method: "PATCH" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  // COB-03
  it("COB-03: débito SIN número de transacción mantiene 'Cobrar' deshabilitado", () => {
    renderModal();
    fireEvent.change(metodo(1), { target: { value: "debito" } });
    expect(cobrar()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("N° de transacción del pago 1"), { target: { value: "TRX-1" } });
    expect(cobrar()).toBeEnabled();
  });

  // COB-04
  it("COB-04: al validar una NC se consulta GET /api/notas-credito?numero_nc y el monto aplicado es mín(disponible, total)", async () => {
    renderModal();
    await validarNc("NC-20260805-ABC123");

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith("/api/notas-credito?numero_nc=NC-20260805-ABC123&clienteId=cli-1"));
    await waitFor(() => expect(screen.getByText("NC-20260805-ABC123")).toBeInTheDocument());
    expect(monto(1)).toHaveValue(15000);
  });

  // COB-05
  it("COB-05: NC que cubre el total → PATCH con un solo pago de NC por el total", async () => {
    const { onSuccess } = renderModal();
    await validarNc("NC-20260805-ABC123");
    await waitFor(() => expect(screen.getByText("NC-20260805-ABC123")).toBeInTheDocument());

    fireEvent.click(cobrar());
    await waitFor(() => expect(bodyPatch()).toEqual({
      accion: "completar",
      pagos: [{ metodo: "nota_credito", monto: 15000, notaCreditoId: "nc-1" }],
    }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  // COB-06
  it("COB-06: NC con monto menor al total → muestra lo que falta y exige otro medio para el resto", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/notas-credito")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { id: "nc-1", numero_nc: "NC-PAR", monto_total: 6000, monto_disponible: 6000, fecha_vencimiento: "2026-12-31" } }),
        });
      }
      return mockFetchDefaultImpl(url);
    });
    renderModal();
    await validarNc("NC-PAR");

    await waitFor(() => expect(monto(1)).toHaveValue(6000));
    expect(screen.getByTestId("resto-pago")).toHaveTextContent("Falta $9.000");
    expect(cobrar()).toBeDisabled();

    fireEvent.click(screen.getByText("+ Agregar medio de pago"));
    expect(monto(2)).toHaveValue(9000);
    expect(cobrar()).toBeEnabled();
  });

  // COB-07
  it("COB-07: NC inexistente → mensaje de error y no deja cobrar", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/notas-credito")) {
        return Promise.resolve({ ok: false, json: async () => ({ error: "NC no encontrada" }) });
      }
      return mockFetchDefaultImpl(url);
    });
    renderModal();
    await validarNc("NC-X");

    await waitFor(() => expect(screen.getByText("NC no encontrada")).toBeInTheDocument());
    expect(cobrar()).toBeDisabled();
  });

  // COB-08
  it("COB-08: fallo del PATCH → muestra el error de la API en pantalla y no llama onSuccess", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/citas/")) {
        return Promise.resolve({ ok: false, json: async () => ({ error: "La cita ya fue completada" }) });
      }
      return mockFetchDefaultImpl(url);
    });
    const { onSuccess } = renderModal();
    fireEvent.click(cobrar());

    await waitFor(() => expect(screen.getByText("La cita ya fue completada")).toBeInTheDocument());
    expect(onSuccess).not.toHaveBeenCalled();
  });

  // COB-09 — pago mixto
  it("COB-09: efectivo + saldo a favor del cliente de la cita → PATCH con ambos pagos", async () => {
    const { onSuccess } = renderModal();
    fireEvent.change(monto(1), { target: { value: "10000" } });
    fireEvent.click(screen.getByText("+ Agregar medio de pago"));
    fireEvent.change(metodo(2), { target: { value: "saldo_a_favor" } });
    expect(await screen.findByText("Saldo disponible: $5.000")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith("/api/saldos-a-favor?clienteId=cli-1");

    fireEvent.click(cobrar());
    await waitFor(() => expect(bodyPatch()).toEqual({
      accion: "completar",
      pagos: [{ metodo: "efectivo", monto: 10000 }, { metodo: "saldo_a_favor", monto: 5000 }],
    }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  // COB-10 — aviso fiscal también en el cobro de citas (Res. Ex. SII 176/2020)
  it("COB-10: aviso de boleta: crédito $10.000 + efectivo $5.000 → boletear $5.000", () => {
    renderModal();
    fireEvent.change(monto(1), { target: { value: "5000" } });
    fireEvent.click(screen.getByText("+ Agregar medio de pago"));
    fireEvent.change(metodo(2), { target: { value: "credito" } });
    fireEvent.change(screen.getByLabelText("N° de transacción del pago 2"), { target: { value: "T-9" } });
    expect(screen.getByTestId("aviso-boleta")).toHaveTextContent("Emitir boleta SII por $5.000");
  });
});
