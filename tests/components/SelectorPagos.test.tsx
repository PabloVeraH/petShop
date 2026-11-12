/**
 * SP-01…SP-10: SelectorPagos (src/components/pagos/SelectorPagos.tsx) — pago
 * mixto, docs/plan_pago_mixto.md F7. Los gates de UI (opciones deshabilitadas,
 * montos máximos) son conveniencia: la autoridad es el servidor (validarPagos +
 * RPC aplicar_pagos; I-787…I-799 y PMX-SQL-*).
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import SelectorPagos, { errorFilas, filasIniciales, type FilaPago } from "@/components/pagos/SelectorPagos";

const CLIENTE = "123e4567-e89b-12d3-a456-426614174020";

let respuestas: Record<string, { ok: boolean; body: unknown }> = {};
const fetchMock = jest.fn((url: string) => {
  const clave = Object.keys(respuestas).find((k) => url.startsWith(k));
  const r = clave ? respuestas[clave] : { ok: false, body: { error: "no mock" } };
  return Promise.resolve({ ok: r.ok, json: async () => r.body });
});
global.fetch = fetchMock as unknown as typeof fetch;

// Contenedor con estado, como lo usan ModalPago / ModalCobroCita.
function Harness({ total, clienteId, inicial }: { total: number; clienteId?: string; inicial?: FilaPago[] }) {
  const [filas, setFilas] = useState<FilaPago[]>(inicial ?? filasIniciales(total));
  const [saldo, setSaldo] = useState<number | null>(null);
  const error = errorFilas(filas, total, clienteId, saldo);
  return (
    <>
      <SelectorPagos total={total} filas={filas} onChange={setFilas} clienteId={clienteId} onSaldoDisponible={setSaldo} />
      <output data-testid="error">{error ?? "OK"}</output>
      <output data-testid="filas">{JSON.stringify(filas.map(({ metodo, monto, nc }) => ({ metodo, monto, nc: nc?.id })))}</output>
    </>
  );
}

const metodo = (i: number) => screen.getByLabelText(`Método del pago ${i}`);
const monto = (i: number) => screen.getByLabelText(`Monto del pago ${i}`);
const filas = () => JSON.parse(screen.getByTestId("filas").textContent!);

beforeEach(() => {
  fetchMock.mockClear();
  respuestas = {};
});

describe("SelectorPagos — nota de crédito", () => {
  it("SP-01: validar la NC consulta el código (URL codificada) y aplica mín(disponible, lo que falta)", async () => {
    respuestas["/api/notas-credito"] = {
      ok: true,
      body: { data: { id: "nc-1", numero_nc: "NC 1", monto_disponible: 3000, fecha_vencimiento: null } },
    };
    render(<Harness total={10000} />);
    fireEvent.change(metodo(1), { target: { value: "nota_credito" } });
    expect(screen.getByTestId("error")).toHaveTextContent("Valida la nota de crédito");
    fireEvent.change(screen.getByLabelText("Código de la nota de crédito"), { target: { value: " NC 1 " } });
    fireEvent.click(screen.getByText("Validar"));

    await waitFor(() => expect(filas()[0]).toEqual({ metodo: "nota_credito", monto: 3000, nc: "nc-1" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/notas-credito?numero_nc=NC%201");
    expect(screen.getByText(/disponible \$3\.000/)).toBeInTheDocument();
    // Falta el resto: no se puede cobrar todavía.
    expect(screen.getByTestId("resto-pago")).toHaveTextContent("Falta $7.000");
  });

  it("SP-02: una NC mayor a lo que falta se aplica solo por lo que falta", async () => {
    respuestas["/api/notas-credito"] = { ok: true, body: { data: { id: "nc-1", numero_nc: "NC-1", monto_disponible: 50000, fecha_vencimiento: null } } };
    render(<Harness total={10000} />);
    fireEvent.change(metodo(1), { target: { value: "nota_credito" } });
    fireEvent.change(screen.getByLabelText("Código de la nota de crédito"), { target: { value: "NC-1" } });
    fireEvent.click(screen.getByText("Validar"));
    await waitFor(() => expect(filas()[0].monto).toBe(10000));
    expect(screen.getByTestId("error")).toHaveTextContent("OK");
  });

  it("SP-03: el error de la API (p. ej. reembolso directo, 409) se muestra y la fila queda sin NC", async () => {
    respuestas["/api/notas-credito"] = { ok: false, body: { error: "Esta nota de crédito ya se reembolsó directamente al cliente" } };
    render(<Harness total={10000} />);
    fireEvent.change(metodo(1), { target: { value: "nota_credito" } });
    fireEvent.change(screen.getByLabelText("Código de la nota de crédito"), { target: { value: "NC-9" } });
    fireEvent.click(screen.getByText("Validar"));
    expect(await screen.findByText(/reembolsó directamente/)).toBeInTheDocument();
    expect(filas()[0].nc).toBeUndefined();
    expect(screen.getByTestId("error")).toHaveTextContent("Valida la nota de crédito");
  });

  it("SP-04: errorFilas rechaza un monto de NC mayor a su disponible aunque la suma cuadre", () => {
    const f: FilaPago[] = [{ id: "a", metodo: "nota_credito", monto: 5000, nc: { id: "nc", numero_nc: "N", monto_disponible: 3000, fecha_vencimiento: null } },
      { id: "b", metodo: "efectivo", monto: 5000 }];
    expect(errorFilas(f, 10000)).toMatch(/\$3\.000 disponibles/);
  });
});

describe("SelectorPagos — saldo a favor", () => {
  it("SP-05: con cliente muestra el saldo disponible y rechaza montos mayores", async () => {
    respuestas["/api/saldos-a-favor"] = { ok: true, body: { saldo_disponible: 2500 } };
    render(<Harness total={10000} clienteId={CLIENTE} />);
    fireEvent.change(metodo(1), { target: { value: "saldo_a_favor" } });
    expect(await screen.findByText("Saldo disponible: $2.500")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/saldos-a-favor?clienteId=${CLIENTE}`);
    fireEvent.change(monto(1), { target: { value: "3000" } });
    fireEvent.click(screen.getByText("+ Agregar medio de pago"));
    expect(screen.getByTestId("error")).toHaveTextContent("El saldo a favor disponible es $2.500");
    fireEvent.change(monto(1), { target: { value: "2500" } });
    fireEvent.change(monto(2), { target: { value: "7500" } });
    expect(screen.getByTestId("error")).toHaveTextContent("OK");
  });

  it("SP-06: si la consulta de saldo falla, el error se muestra", async () => {
    respuestas["/api/saldos-a-favor"] = { ok: false, body: { error: "Error consultando saldo" } };
    render(<Harness total={10000} clienteId={CLIENTE} />);
    fireEvent.change(metodo(1), { target: { value: "saldo_a_favor" } });
    expect(await screen.findByText("Error consultando saldo")).toBeInTheDocument();
  });

  it("SP-07: con NC en una fila, otra fila no puede elegir saldo a favor ni otra NC (D8)", () => {
    const inicial: FilaPago[] = [
      { id: "a", metodo: "nota_credito", monto: 0 },
      { id: "b", metodo: "efectivo", monto: 10000 },
    ];
    render(<Harness total={10000} clienteId={CLIENTE} inicial={inicial} />);
    const opciones = Array.from((metodo(2) as HTMLSelectElement).options);
    expect(opciones.find((o) => o.value === "saldo_a_favor")!.disabled).toBe(true);
    expect(opciones.find((o) => o.value === "nota_credito")!.disabled).toBe(true);
    expect(opciones.find((o) => o.value === "debito")!.disabled).toBe(false);
  });
});

describe("SelectorPagos — filas", () => {
  it("SP-08: máximo 5 medios: con 5 filas desaparece 'Agregar' aunque falte monto", () => {
    const inicial: FilaPago[] = Array.from({ length: 5 }, (_, i) => ({ id: String(i), metodo: "efectivo" as const, monto: 1000 }));
    render(<Harness total={10000} inicial={inicial} />);
    expect(screen.getByTestId("resto-pago")).toHaveTextContent("Falta $5.000");
    expect(screen.queryByText("+ Agregar medio de pago")).not.toBeInTheDocument();
  });

  it("SP-09: quitar una fila la elimina y recalcula el resto; con una sola fila no hay botón Quitar", () => {
    const inicial: FilaPago[] = [{ id: "a", metodo: "efectivo", monto: 4000 }, { id: "b", metodo: "efectivo", monto: 6000 }];
    render(<Harness total={10000} inicial={inicial} />);
    fireEvent.click(screen.getByLabelText("Quitar pago 2"));
    expect(screen.getAllByTestId(/^fila-pago-/)).toHaveLength(1);
    expect(screen.getByTestId("resto-pago")).toHaveTextContent("Falta $6.000");
    expect(screen.queryByLabelText(/Quitar pago/)).not.toBeInTheDocument();
  });

  it("SP-10: cambiar de débito a efectivo descarta el N° de transacción", () => {
    const inicial: FilaPago[] = [{ id: "a", metodo: "debito", monto: 10000, numeroTransaccion: "T-1" }];
    render(<Harness total={10000} inicial={inicial} />);
    expect(screen.getByLabelText("N° de transacción del pago 1")).toHaveValue("T-1");
    fireEvent.change(metodo(1), { target: { value: "efectivo" } });
    expect(screen.queryByLabelText(/N° de transacción/)).not.toBeInTheDocument();
    fireEvent.change(metodo(1), { target: { value: "credito" } });
    expect(screen.getByLabelText("N° de transacción del pago 1")).toHaveValue("");
  });
});
