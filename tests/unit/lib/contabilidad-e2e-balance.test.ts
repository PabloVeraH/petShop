const {
  lineasVenta,
  lineasNotaCredito,
  lineasCompra,
  lineasPagoProveedor,
  lineasCierreCOGS,
} = require("@/lib/contabilidad/generador-asientos");

function totalDebito(lineas: { debito: number }[]) {
  return lineas.reduce((s, l) => s + l.debito, 0);
}
function totalCredito(lineas: { credito: number }[]) {
  return lineas.reduce((s, l) => s + l.credito, 0);
}
function isBalanced(lineas: { debito: number; credito: number }[]) {
  const td = Math.round(totalDebito(lineas) * 100) / 100;
  const tc = Math.round(totalCredito(lineas) * 100) / 100;
  return td === tc;
}

describe("E2E Balance Invariant", () => {
  describe("escenario completo: ventas + compras + devoluciones + pagos + COGS", () => {
    it("acumulado de todos los asientos sigue balanceado", () => {
      const todasLasLineas = [
        ...lineasVenta({ metodoPago: "efectivo", montoNeto: 10000, iva: 1900, total: 11900 }),
        ...lineasVenta({ metodoPago: "debito", montoNeto: 20000, iva: 3800, total: 23800 }),
        ...lineasVenta({ metodoPago: "credito", montoNeto: 5000, iva: 950, total: 5950 }),
        ...lineasNotaCredito({ monto: 2000, tipoReembolso: "caja" }),
        ...lineasNotaCredito({ monto: 1500, tipoReembolso: "saldo_a_favor" }),
        ...lineasCompra({ montoNeto: 15000, iva: 2850, total: 17850 }),
        ...lineasPagoProveedor(17850),
        ...lineasCierreCOGS(12000),
      ];

      const td = Math.round(totalDebito(todasLasLineas) * 100) / 100;
      const tc = Math.round(totalCredito(todasLasLineas) * 100) / 100;

      expect(td).toBe(tc);
    });

    it("cada asiento individual está balanceado", () => {
      const asientos = [
        lineasVenta({ metodoPago: "efectivo", montoNeto: 8000, iva: 1520, total: 9520 }),
        lineasVenta({ metodoPago: "transferencia", montoNeto: 3000, iva: 570, total: 3570 }),
        lineasNotaCredito({ monto: 1000, tipoReembolso: "caja" }),
        lineasNotaCredito({ monto: 500, tipoReembolso: "saldo_a_favor" }),
        lineasCompra({ montoNeto: 6000, iva: 1140, total: 7140 }),
        lineasPagoProveedor(7140),
        lineasCierreCOGS(5000),
      ];

      asientos.forEach((lineas, i) => {
        expect(isBalanced(lineas)).toBe(true);
      });
    });
  });

  describe("escenario con montos decimales", () => {
    it("montos con centavos no rompen el balance", () => {
      const lineas = [
        ...lineasVenta({ metodoPago: "efectivo", montoNeto: 12345.67, iva: 2345.67, total: 14691.34 }),
        ...lineasCompra({ montoNeto: 9876.54, iva: 1876.54, total: 11753.08 }),
      ];

      expect(isBalanced(lineas)).toBe(true);
    });

    it("suma de múltiples ventas pequeñas con decimales sigue balanceada", () => {
      const ventas = Array.from({ length: 10 }, (_, i) =>
        lineasVenta({
          metodoPago: i % 2 === 0 ? "efectivo" : "debito",
          montoNeto: 1000.33,
          iva: 190.06,
          total: 1190.39,
        })
      );

      const todasLineas = ventas.flat();
      expect(isBalanced(todasLineas)).toBe(true);
    });
  });

  describe("escenario de cierre de mes completo", () => {
    it("mes con múltiples ventas, compras y COGS está balanceado", () => {
      const ventasDiarias = Array.from({ length: 30 }, (_, i) =>
        lineasVenta({
          metodoPago: ["efectivo", "debito", "credito", "transferencia"][i % 4],
          montoNeto: 5000 + i * 100,
          iva: Math.round((5000 + i * 100) * 0.19),
          total: Math.round((5000 + i * 100) * 1.19),
        })
      );

      const comprasMensuales = [
        lineasCompra({ montoNeto: 80000, iva: 15200, total: 95200 }),
        lineasCompra({ montoNeto: 20000, iva: 3800, total: 23800 }),
      ];

      const cogs = lineasCierreCOGS(75000);

      const todasLineas = [...ventasDiarias.flat(), ...comprasMensuales.flat(), ...cogs];

      const td = Math.round(totalDebito(todasLineas) * 100) / 100;
      const tc = Math.round(totalCredito(todasLineas) * 100) / 100;
      expect(td).toBe(tc);
    });
  });

  describe("rendimiento", () => {
    it("generar 1000 asientos de venta en menos de 1 segundo", () => {
      const inicio = Date.now();

      for (let i = 0; i < 1000; i++) {
        lineasVenta({ metodoPago: "efectivo", montoNeto: 10000, iva: 1900, total: 11900 });
      }

      const duracion = Date.now() - inicio;
      expect(duracion).toBeLessThan(1000);
    });

    it("generar 1000 asientos de compra en menos de 1 segundo", () => {
      const inicio = Date.now();

      for (let i = 0; i < 1000; i++) {
        lineasCompra({ montoNeto: 10000, iva: 1900, total: 11900 });
      }

      const duracion = Date.now() - inicio;
      expect(duracion).toBeLessThan(1000);
    });

    it("generar 500 asientos mixtos en menos de 1 segundo", () => {
      const inicio = Date.now();

      for (let i = 0; i < 500; i++) {
        lineasVenta({ metodoPago: "efectivo", montoNeto: 5000, iva: 950, total: 5950 });
        lineasCompra({ montoNeto: 3000, iva: 570, total: 3570 });
        lineasNotaCredito({ monto: 500, tipoReembolso: "caja" });
        lineasPagoProveedor(3570);
        lineasCierreCOGS(2500);
      }

      const duracion = Date.now() - inicio;
      expect(duracion).toBeLessThan(1000);
    });
  });
});
