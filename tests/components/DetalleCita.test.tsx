/**
 * Tests DET-01 a DET-04: DetalleCita — modal de detalle completo de una cita
 * (ticket 6a7160fe621dcf1dba95b92f). El listado no tenía forma de ver el
 * detalle y cancelado_at (fecha de cancelación) nunca se desplegaba en la UI.
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

jest.mock("@/components/ui/button", () => ({
  Button: function Button({ children, onClick, disabled, variant }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: string;
  }) {
    return <button onClick={onClick} disabled={disabled} data-variant={variant}>{children}</button>;
  },
}));

import { DetalleCita } from "@/app/(app)/citas/components/DetalleCita";
import type { Cita } from "@/types";

// ISO de una fecha/hora dada en hora local → deterministico en cualquier huso.
function isoLocal(y: number, m: number, d: number, hh: number, mm: number): string {
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

const CANCELADA_EN = isoLocal(2026, 8, 4, 3, 47);

function citaBase(overrides: Partial<Cita> = {}): Cita {
  return {
    id: "cita-1",
    store_id: "st-1",
    servicio_id: "srv-1",
    cliente_id: "cli-1",
    mascota_id: "mas-1",
    encargado_id: "enc-1",
    fecha: "2026-08-10",
    hora_inicio: "10:00:00",
    hora_fin: "10:30:00",
    duracion_minutos: 30,
    precio: 15000,
    venta_id: null,
    estado: "confirmada",
    notas: null,
    motivo_cancelacion: null,
    cancelado_at: null,
    cancelado_por: null,
    created_by: "u1",
    created_at: "",
    updated_at: "",
    cliente: { nombre: "Carlos Rojas", telefono: "912345678" },
    mascota: { nombre: "Firulais" },
    servicio: { nombre: "Peluquería" },
    encargado: { nombre: "Juan Pérez" },
    ...overrides,
  } as Cita;
}

describe("DetalleCita (DET-XX)", () => {
  // DET-01
  it("DET-01: cita confirmada muestra el detalle completo (cliente, mascota, servicio, encargado, precio)", () => {
    render(<DetalleCita cita={citaBase()} onClose={() => {}} />);

    expect(screen.getByText("Detalle de cita")).toBeInTheDocument();
    expect(screen.getByText("Confirmada")).toBeInTheDocument();
    expect(screen.getByText("2026-08-10 · 10:00–10:30")).toBeInTheDocument();
    expect(screen.getByText("Carlos Rojas · 912345678")).toBeInTheDocument();
    expect(screen.getByText("Firulais")).toBeInTheDocument();
    expect(screen.getByText("Peluquería · 30 min")).toBeInTheDocument();
    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
    expect(screen.getByText("$15.000")).toBeInTheDocument();
    // No hay sección de cancelación.
    expect(screen.queryByText(/Motivo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cancelada el/)).not.toBeInTheDocument();
  });

  // DET-02 — el requisito del ticket: estado, motivo Y fecha de cancelación.
  it("DET-02: cita cancelada muestra motivo y fecha de cancelación", () => {
    render(
      <DetalleCita
        cita={citaBase({ estado: "cancelada", motivo_cancelacion: "Cliente no puede asistir", cancelado_at: CANCELADA_EN })}
        onClose={() => {}}
      />
    );

    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(screen.getByText("Cliente no puede asistir")).toBeInTheDocument();
    expect(screen.getByText("04/08/2026 03:47")).toBeInTheDocument();
  });

  // DET-03
  it("DET-03: cita sin encargado ni precio muestra 'Sin asignar' y omite la fila de precio", () => {
    render(<DetalleCita cita={citaBase({ encargado: null, precio: null })} onClose={() => {}} />);

    expect(screen.getByText("Sin asignar")).toBeInTheDocument();
    expect(screen.queryByText("$15.000")).not.toBeInTheDocument();
  });

  // DET-04
  it("DET-04: click en Cerrar llama a onClose", () => {
    const onClose = jest.fn();
    render(<DetalleCita cita={citaBase()} onClose={onClose} />);

    fireEvent.click(screen.getByText("Cerrar"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // DET-05 — ticket 6a716208e49a7be4739d1c73: completar una cita con precio
  // genera una venta (completar_cita_tx); el detalle de la cita debe mostrar
  // la referencia a esa venta (fila "Venta #…"). Sin ella, el usuario no ve
  // ningún vínculo entre la cita completada y la venta que /sales lista — el
  // síntoma del ticket. Regresión de la integración completar→venta.
  it("DET-05: cita completada con venta_id muestra la fila 'Venta #…' (vínculo con la venta generada)", () => {
    render(
      <DetalleCita
        cita={citaBase({ estado: "completada", venta_id: "11111111-2222-3333-4444-555555555555" })}
        onClose={() => {}}
      />
    );

    expect(screen.getByText("Completada")).toBeInTheDocument();
    expect(screen.getByText("#11111111\u2026")).toBeInTheDocument();
  });

  // DET-06 — complemento: una cita sin venta_id (confirmada legado o recién
  // creada) NO muestra la fila de Venta — evita falsear "generó venta".
  it("DET-06: cita sin venta_id no muestra la fila 'Venta'", () => {
    render(<DetalleCita cita={citaBase()} onClose={() => {}} />);
    expect(screen.queryByText("Venta")).not.toBeInTheDocument();
  });
});
