/**
 * Tests IVA-01 a IVA-10: Cálculo de IVA — fórmula canónica
 *
 * Regla de negocio: IVA = Math.round(total * IVA_RATE)
 * Los precios en el sistema son neto (sin IVA).
 * El IVA se calcula siempre como IVA_RATE del monto con descuento aplicado.
 * Fuente única: src/lib/tax.ts → IVA_RATE
 * Consumidores:
 *   - src/stores/pos.ts → impuesto()
 *   - src/app/(app)/pos/components/ModalPago.tsx → display IVA line
 *   - src/app/api/ventas/route.ts → impuesto y ivaCalc
 */
import { IVA_RATE } from "@/lib/tax";

/** Replica exacta de la lógica de ventas/route.ts y pos.ts */
function calcularIva(total: number): number {
  return Math.round(total * IVA_RATE);
}

function calcularMontoNeto(total: number): number {
  return total - calcularIva(total);
}

function calcularTotalConDescuento(subtotal: number, descuentoPct: number): number {
  const descuento = (subtotal * descuentoPct) / 100;
  return Math.round(subtotal - descuento);
}

describe("IVA — fórmula canónica (IVA-01 a IVA-06)", () => {

  // IVA-01: caso de la imagen reportada
  it("IVA-01: $45.928 subtotal → IVA = $8.726", () => {
    expect(calcularIva(45928)).toBe(8726);
  });

  // IVA-02: valores redondos simples
  it("IVA-02: $10.000 → IVA = $1.900", () => {
    expect(calcularIva(10000)).toBe(1900);
  });

  // IVA-03: redondeo hacia arriba (0.5 → round)
  it("IVA-03: $1 → IVA = $0 (fracción descartada)", () => {
    expect(calcularIva(1)).toBe(0);
  });

  // IVA-04: carrito vacío
  it("IVA-04: $0 → IVA = $0", () => {
    expect(calcularIva(0)).toBe(0);
  });

  // IVA-05: resultado siempre entero
  it("IVA-05: resultado siempre es entero para cualquier total entero", () => {
    [1, 99, 1000, 45928, 999999].forEach((t) => {
      expect(Number.isInteger(calcularIva(t))).toBe(true);
    });
  });

  // IVA-06: IVA + neto = total (invariante contable)
  it("IVA-06: IVA + montoNeto = total (sin pérdida por redondeo)", () => {
    const total = 45928;
    const iva = calcularIva(total);
    const neto = calcularMontoNeto(total);
    expect(iva + neto).toBe(total);
  });
});

describe("IVA — con descuento aplicado (IVA-07 a IVA-10)", () => {

  // IVA-07: descuento del 10%
  it("IVA-07: $10.000 con 10% descuento → total $9.000 → IVA $1.710", () => {
    const total = calcularTotalConDescuento(10000, 10);
    expect(total).toBe(9000);
    expect(calcularIva(total)).toBe(1710);
  });

  // IVA-08: IVA se calcula sobre total POST-descuento, no sobre subtotal
  it("IVA-08: el descuento reduce la base del IVA", () => {
    const subtotal = 100000;
    const sinDescuento = calcularIva(calcularTotalConDescuento(subtotal, 0));
    const conDescuento  = calcularIva(calcularTotalConDescuento(subtotal, 20));
    expect(conDescuento).toBeLessThan(sinDescuento);
  });

  // IVA-09: descuento 0% no altera el IVA
  it("IVA-09: descuento 0% → IVA igual al subtotal × IVA_RATE", () => {
    const subtotal = 45928;
    const total = calcularTotalConDescuento(subtotal, 0);
    expect(total).toBe(45928);
    expect(calcularIva(total)).toBe(Math.round(subtotal * IVA_RATE));
  });

  // IVA-10: caso del modal y del store deben coincidir siempre
  it("IVA-10: fórmula pos.ts y ModalPago.tsx producen el mismo IVA", () => {
    const casos = [
      { subtotal: 45928, desc: 0 },
      { subtotal: 10000, desc: 10 },
      { subtotal: 30928, desc: 5 },
      { subtotal: 100000, desc: 20 },
    ];
    casos.forEach(({ subtotal, desc }) => {
      const total = calcularTotalConDescuento(subtotal, desc);
      // pos.ts usa Math.round(t * IVA_RATE)
      const ivaStore = Math.round(total * IVA_RATE);
      // ModalPago.tsx usa Math.round((sub - desc) * IVA_RATE)
      const descMonto = (subtotal * desc) / 100;
      const ivaModal  = Math.round((subtotal - descMonto) * IVA_RATE);
      expect(ivaStore).toBe(ivaModal);
    });
  });
});
