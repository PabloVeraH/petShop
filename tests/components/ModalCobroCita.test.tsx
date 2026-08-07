/**
 * Tests COB-01 a COB-08: ModalCobroCita — modal de cobro de cita (Fase 4).
 * Duplica el selector de pago + validación de NC de ModalPago (decisión §8c
 * del plan_valorServicio) y dispara el PATCH completar de la cita.
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
  servicio: { nombre: "Peluquería" },
} as const;

const NC_MOCK = {
  data: {
    id: "nc-1",
    numero_nc: "NC-20260805-ABC123",
    monto_total: 15000,
    fecha_vencimiento: "2026-12-31",
  },
};

function mockFetchDefaultImpl(url: string, init?: RequestInit) {
  if (url.startsWith("/api/notas-credito")) return Promise.resolve({ ok: true, json: async () => NC_MOCK });
  if (url.startsWith("/api/citas/")) {
    const ok = !(init?.body?.includes('"accion":"completar"') && JSON.parse(init.body as string).metodoPago === "debito" && !JSON.parse(init.body as string).numeroTransaccion);
    return Promise.resolve({ ok, json: async () => ({ id: CITA.id, estado: "completada" }) });
  }
  return Promise.resolve({ ok: true, json: async () => ({}) });
}

function renderModal() {
  const onClose = jest.fn();
  const onSuccess = jest.fn();
  render(<ModalCobroCita cita={CITA as never} onClose={onClose} onSuccess={onSuccess} />);
  return { onClose, onSuccess };
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
  it("COB-02: con efectivo (default) 'Cobrar' dispara PATCH completar con metodoPago efectivo", async () => {
    const { onSuccess } = renderModal();
    fireEvent.click(screen.getByText("Cobrar $15.000"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/citas/cita-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ accion: "completar", metodoPago: "efectivo", numeroTransaccion: undefined, pagoNc: undefined }),
        })
      );
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  // COB-03
  it("COB-03: débito SIN número de transacción mantiene 'Cobrar' deshabilitado", async () => {
    renderModal();
    fireEvent.click(screen.getByText("Débito"));
    expect(screen.getByText("Cobrar $15.000")).toBeDisabled();

    const trx = screen.getByPlaceholderText("Ej: TRX123456789") as HTMLInputElement;
    fireEvent.change(trx, { target: { value: "TRX-1" } });
    expect(screen.getByText("Cobrar $15.000")).toBeEnabled();
  });

  // COB-04
  it("COB-04: al validar una NC se consulta GET /api/notas-credito?numero_nc y el monto aplicado es min(monto_total, total)", async () => {
    renderModal();
    fireEvent.click(screen.getByText("NC"));

    const input = screen.getByPlaceholderText(/Código NC/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "NC-20260805-ABC123" } });
    fireEvent.click(screen.getByText("Validar"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/notas-credito?numero_nc=NC-20260805-ABC123");
    });
    await waitFor(() => expect(screen.getByText("NC-20260805-ABC123")).toBeInTheDocument());
    // Monto NC = min(monto_total, total) = 15000 — aparece junto al Total.
    expect(screen.getAllByText("$15.000").length).toBeGreaterThanOrEqual(2);
  });

  // COB-05
  it("COB-05: NC que cubre el total → PATCH incluye pagoNc completo y metodoPago nota_credito", async () => {
    const { onSuccess } = renderModal();
    fireEvent.click(screen.getByText("NC"));

    const input = screen.getByPlaceholderText(/Código NC/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "NC-20260805-ABC123" } });
    fireEvent.click(screen.getByText("Validar"));

    await waitFor(() => expect(screen.getByText("NC-20260805-ABC123")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Cobrar $15.000"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/citas/cita-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            accion: "completar",
            metodoPago: "nota_credito",
            numeroTransaccion: undefined,
            pagoNc: { nota_credito_id: "nc-1", numero_nc: "NC-20260805-ABC123", monto: 15000 },
          }),
        })
      );
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  // COB-06
  it("COB-06: NC con monto menor al total → muestra la diferencia y exige método para el resto", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/notas-credito")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { id: "nc-1", numero_nc: "NC-PAR", monto_total: 6000, fecha_vencimiento: "2026-12-31" } }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ id: CITA.id, estado: "completada" }) });
    });
    renderModal();
    fireEvent.click(screen.getByText("NC"));

    const input = screen.getByPlaceholderText(/Código NC/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "NC-PAR" } });
    fireEvent.click(screen.getByText("Validar"));

    await waitFor(() => expect(screen.getByText("$6.000")).toBeInTheDocument());
    expect(screen.getByText("Diferencia a pagar:")).toBeInTheDocument();
    expect(screen.getByText("$9.000")).toBeInTheDocument();
  });

  // COB-07
  it("COB-07: NC inexistente → mensaje de error y no deja cobrar", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/notas-credito")) {
        return Promise.resolve({ ok: false, json: async () => ({ error: "NC no encontrada" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    renderModal();
    fireEvent.click(screen.getByText("NC"));

    const input = screen.getByPlaceholderText(/Código NC/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "NC-X" } });
    fireEvent.click(screen.getByText("Validar"));

    await waitFor(() => expect(screen.getByText("NC no encontrada")).toBeInTheDocument());
    expect(screen.getByText("Cobrar $15.000")).toBeDisabled();
  });

  // COB-08
  it("COB-08: fallo del PATCH → muestra el error de la API en pantalla y no llama onSuccess", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/citas/")) {
        return Promise.resolve({ ok: false, json: async () => ({ error: "La cita ya fue completada" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    const { onSuccess } = renderModal();
    fireEvent.click(screen.getByText("Cobrar $15.000"));

    await waitFor(() => expect(screen.getByText("La cita ya fue completada")).toBeInTheDocument());
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
