/**
 * Tests U-120/U-121: generateBoletaPDF — Subtotal debe reflejar el neto sin IVA
 * del monto efectivamente cobrado (total − impuesto), no el bruto pre-descuento.
 *
 * jsPDF asigna sus métodos (text, setFont, ...) como propiedades propias de cada
 * instancia (no en el prototype), por lo que no se puede espiar con
 * jest.spyOn(jsPDF.prototype, "text"). Se reemplaza el módulo completo por un
 * doble liviano que registra las llamadas a .text(), siguiendo el patrón
 * mock-first (TDD London School) del proyecto.
 */
import type { BoletaData } from "@/lib/reports/pdf-generator";

type TextCall = [string, number, number, Record<string, unknown>?];

class FakeJsPDF {
  textCalls: TextCall[] = [];
  internal = { pageSize: { getWidth: () => 210 } };
  setFontSize() { return this; }
  setFont() { return this; }
  setLineWidth() { return this; }
  line() { return this; }
  text(...args: TextCall) {
    this.textCalls.push(args);
    return this;
  }
  output() { return new ArrayBuffer(0); }
}

jest.mock("jspdf", () => ({
  __esModule: true,
  jsPDF: FakeJsPDF,
  default: FakeJsPDF,
}));

import { generateBoletaPDF } from "@/lib/reports/pdf-generator";

function baseBoleta(overrides: Partial<BoletaData> = {}): BoletaData {
  return {
    numeroComprobante: "20260717-TEST",
    fecha: "2026-07-17T12:00:00.000Z",
    storeName: "PetShop Test",
    items: [{ nombre: "Alimento Pro Plan 3kg", cantidad: 1, precio_unitario: 11900, subtotal: 11900 }],
    subtotal: 11900,
    descuentoPct: 0,
    descuentoMonto: 0,
    impuesto: 1900,
    total: 11900,
    pagos: [{ metodo: "efectivo", monto: 11900 }],
    ...overrides,
  };
}

function valueNextTo(doc: FakeJsPDF, label: string): string | undefined {
  const idx = doc.textCalls.findIndex(([text]) => text === label);
  return idx >= 0 ? (doc.textCalls[idx + 1]?.[0] as string | undefined) : undefined;
}

describe("generateBoletaPDF — Subtotal (U-120/U-121)", () => {
  // U-120: caso sin descuento. NOTA: esta variante NO distingue el código antes/después
  // del fix — netoDesdeBruto(subtotal_bruto_pre_descuento) y (total − impuesto) coinciden
  // matemáticamente cuando descuento=0, porque ahí subtotal_bruto === total. Se mantiene
  // como cobertura de no-regresión del caso más común (venta sin descuento), no como
  // prueba diferenciadora; U-121 es la que sí falla contra el código defectuoso.
  it("U-120: sin descuento, Subtotal muestra el neto (total − impuesto), consistente con Subtotal + IVA = Total", () => {
    const doc = generateBoletaPDF(baseBoleta()) as unknown as FakeJsPDF;

    // Subtotal correcto: 11900 − 1900 = 10000, NO 11900 (bruto == Total)
    expect(valueNextTo(doc, "Subtotal:")).toBe("$10.000");
    expect(valueNextTo(doc, "TOTAL:")).toBe("$11.900");
  });

  // U-121: REGRESIÓN — con descuento, netoDesdeBruto(subtotal_bruto_pre_descuento) daba
  // $16.807 (verificado contra el código previo al fix, ver cierre de la tarea);
  // Subtotal + IVA = Total exige $15.126 (neto del TOTAL post-descuento).
  it("U-121: con descuento, Subtotal + IVA sigue sumando exactamente Total", () => {
    const doc = generateBoletaPDF(
      baseBoleta({
        subtotal: 20000,
        descuentoPct: 10,
        descuentoMonto: 2000,
        impuesto: 2874,
        total: 18000,
      })
    ) as unknown as FakeJsPDF;

    expect(valueNextTo(doc, "Subtotal:")).toBe("$15.126");
    expect(valueNextTo(doc, "IVA (19%):")).toBe("$2.874");
    expect(valueNextTo(doc, "TOTAL:")).toBe("$18.000");
    expect(15126 + 2874).toBe(18000);
  });
});
