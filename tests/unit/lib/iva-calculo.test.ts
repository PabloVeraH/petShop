/**
 * Tests IVA-01 a IVA-10: Cálculo de IVA — fórmula canónica de EXTRACCIÓN
 *
 * Regla de negocio: TODOS los precios del sistema son BRUTOS (IVA incluido).
 * El IVA se EXTRAE del monto bruto:
 *   iva  = Math.round(bruto × IVA_RATE / (1 + IVA_RATE))
 *   neto = bruto − iva
 * Nunca se suma IVA sobre el precio. La fórmula aditiva round(total × 0.19)
 * es la regresión que infló el impuesto de las ventas del 19–22 jun 2026
 * (reparadas en migrations/050_fix_iva_aditivo_ventas_historicas.sql).
 *
 * Fuente única: src/lib/tax.ts → extraerIva() / netoDesdeBruto()
 * Consumidores: pos.ts, ModalPago.tsx, api/ventas, api/recibos,
 * api/canales/orders/[id]/accept, api/contabilidad/backfill,
 * lib/email.ts, lib/reports/pdf-generator.ts, lib/contabilidad/generador-asientos.ts
 */
import fc from "fast-check";
import { IVA_RATE, extraerIva, netoDesdeBruto } from "@/lib/tax";

describe("IVA — fórmula de extracción (IVA-01 a IVA-06)", () => {

  // IVA-01: REGRESIÓN — caso real Whiskas 1kg (venta 20260620-F3455C8D)
  it("IVA-01: $15.458 bruto → IVA extraído $2.468, no $2.937 (aditiva)", () => {
    expect(extraerIva(15458)).toBe(2468);
    expect(extraerIva(15458)).not.toBe(Math.round(15458 * 0.19));
    expect(netoDesdeBruto(15458)).toBe(12990);
  });

  // IVA-02: REGRESIÓN — caso real Whiskas + Bravery (venta 20260622-0E91ECC3)
  it("IVA-02: $23.458 bruto → IVA extraído $3.745, no $4.457 (aditiva)", () => {
    expect(extraerIva(23458)).toBe(3745);
    expect(extraerIva(23458)).not.toBe(4457);
  });

  // IVA-03: valores exactos sin redondeo
  it("IVA-03: $119.000 bruto → IVA $19.000, neto $100.000", () => {
    expect(extraerIva(119000)).toBe(19000);
    expect(netoDesdeBruto(119000)).toBe(100000);
  });

  // IVA-04: carrito vacío
  it("IVA-04: $0 → IVA $0, neto $0", () => {
    expect(extraerIva(0)).toBe(0);
    expect(netoDesdeBruto(0)).toBe(0);
  });

  // IVA-05: montos mínimos — la fracción se descarta, el neto absorbe
  it("IVA-05: $1 → IVA $0, neto $1", () => {
    expect(extraerIva(1)).toBe(0);
    expect(netoDesdeBruto(1)).toBe(1);
  });

  // IVA-06: resultado siempre entero (pesos CLP, sin centavos)
  it("IVA-06: IVA y neto son enteros para cualquier bruto entero", () => {
    [1, 99, 1000, 15458, 45208, 999999].forEach((t) => {
      expect(Number.isInteger(extraerIva(t))).toBe(true);
      expect(Number.isInteger(netoDesdeBruto(t))).toBe(true);
    });
  });
});

describe("IVA — invariantes (IVA-07 a IVA-08, fast-check)", () => {

  // IVA-07: invariante contable — neto + IVA reconstruye el bruto exacto
  it("IVA-07: extraerIva(t) + netoDesdeBruto(t) === t para todo entero t ≥ 0", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), (t) => {
        return extraerIva(t) + netoDesdeBruto(t) === t;
      })
    );
  });

  // IVA-08: significado fiscal — el IVA extraído es el 19% del neto (±1 por redondeo)
  it("IVA-08: |extraerIva(t) − neto × IVA_RATE| ≤ 1 para todo entero t ≥ 0", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), (t) => {
        const iva = extraerIva(t);
        const neto = netoDesdeBruto(t);
        return Math.abs(iva - neto * IVA_RATE) <= 1;
      })
    );
  });
});

describe("IVA — con descuento aplicado (IVA-09 a IVA-10)", () => {

  // IVA-09: el IVA se extrae del total POST-descuento (misma lógica que pos.ts)
  it("IVA-09: $10.000 con 10% descuento → total $9.000 → IVA $1.437", () => {
    const subtotal = 10000;
    const total = Math.round(subtotal - (subtotal * 10) / 100);
    expect(total).toBe(9000);
    expect(extraerIva(total)).toBe(1437);
  });

  // IVA-10: REGRESIÓN — mismo producto, mismo total, mismo IVA (consistencia histórica)
  // Whiskas $45.208: mayo (extracción $7.218) vs junio (aditiva $8.590) debían coincidir
  it("IVA-10: $45.208 bruto → IVA $7.218 siempre, nunca $8.590", () => {
    expect(extraerIva(45208)).toBe(7218);
    expect(extraerIva(45208)).not.toBe(8590);
  });
});
