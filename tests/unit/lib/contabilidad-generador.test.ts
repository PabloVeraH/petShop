const {
  lineasVenta,
  lineasVentaCOGS,
  lineasNotaCredito,
  lineasCompra,
  lineasPagoProveedor,
  lineasCierreCOGS,
  lineasAnulacionVentaCanal,
  lineasAnulacionCOGS,
  lineasNotaCreditoCOGS,
} = require("@/lib/contabilidad/generador-asientos");

const { CUENTAS } = require("@/lib/contabilidad/types");

describe("Generador de Asientos Contables", () => {
  describe("lineasVenta - Venta Efectivo", () => {
    it("debe crear líneas balanceadas para venta en efectivo", () => {
      const lineas = lineasVenta({
        metodoPago: "efectivo",
        montoNeto: 10000,
        iva: 1900,
        total: 11900,
      });

      expect(lineas).toHaveLength(3);

      const debitos = lineas.reduce((s, l) => s + l.debito, 0);
      const creditos = lineas.reduce((s, l) => s + l.credito, 0);

      expect(debitos).toBe(11900);
      expect(creditos).toBe(11900);
      expect(debitos).toBe(creditos);
    });

    it("debe usar cuenta Caja para efectivo", () => {
      const lineas = lineasVenta({
        metodoPago: "efectivo",
        montoNeto: 10000,
        iva: 1900,
        total: 11900,
      });

      const lineaCaja = lineas.find((l) => l.cuentaCodigo === CUENTAS.CAJA.codigo);
      expect(lineaCaja?.debito).toBe(11900);
    });

    it("debe usar cuenta Banco para métodos digitales", () => {
      const lineas = lineasVenta({
        metodoPago: "debito",
        montoNeto: 10000,
        iva: 1900,
        total: 11900,
      });

      const lineaBanco = lineas.find((l) => l.cuentaCodigo === CUENTAS.BANCO.codigo);
      expect(lineaBanco?.debito).toBe(11900);
    });
  });

  describe("lineasVenta - Venta Débito/Crédito/Transferencia", () => {
    it("debe crear líneas correctas para venta con tarjeta", () => {
      const lineas = lineasVenta({
        metodoPago: "credito",
        montoNeto: 20000,
        iva: 3800,
        total: 23800,
      });

      expect(lineas).toHaveLength(3);
      
      const debitos = lineas.reduce((s, l) => s + l.debito, 0);
      const creditos = lineas.reduce((s, l) => s + l.credito, 0);

      expect(debitos).toBe(23800);
      expect(creditos).toBe(23800);
    });

    it("debe manejar transferencia correctamente", () => {
      const lineas = lineasVenta({
        metodoPago: "transferencia",
        montoNeto: 5000,
        iva: 950,
        total: 5950,
      });

      const lineaBanco = lineas.find((l) => l.cuentaCodigo === CUENTAS.BANCO.codigo);
      expect(lineaBanco?.debito).toBe(5950);
    });
  });

  describe("lineasVentaCOGS - Costo de Venta por Venta Individual", () => {
    it("debe crear líneas balanceadas para COGS de una venta", () => {
      const lineas = lineasVentaCOGS(25000);

      expect(lineas).toHaveLength(2);

      const debitos = lineas.reduce((s, l) => s + l.debito, 0);
      const creditos = lineas.reduce((s, l) => s + l.credito, 0);

      expect(debitos).toBe(25000);
      expect(creditos).toBe(25000);
    });

    it("debe debitar cuenta COGS (510101)", () => {
      const lineas = lineasVentaCOGS(35000);

      const lineaCOGS = lineas.find(
        (l) => l.cuentaCodigo === CUENTAS.COGS.codigo
      );
      expect(lineaCOGS?.debito).toBe(35000);
      expect(lineaCOGS?.credito).toBe(0);
      expect(lineaCOGS?.descripcionLinea).toBe("COGS venta del período");
    });

    it("debe creditar cuenta Inventario (111001)", () => {
      const lineas = lineasVentaCOGS(18000);

      const lineaInventario = lineas.find(
        (l) => l.cuentaCodigo === CUENTAS.INVENTARIO.codigo
      );
      expect(lineaInventario?.credito).toBe(18000);
      expect(lineaInventario?.debito).toBe(0);
      expect(lineaInventario?.descripcionLinea).toBe("Reducción de inventario por venta");
    });

    it("debe funcionar con costo cero", () => {
      const lineas = lineasVentaCOGS(0);

      expect(lineas).toHaveLength(2);
      const debitos = lineas.reduce((s, l) => s + l.debito, 0);
      const creditos = lineas.reduce((s, l) => s + l.credito, 0);
      expect(debitos).toBe(0);
      expect(creditos).toBe(0);
    });

    it("debe funcionar con montos grandes", () => {
      const lineas = lineasVentaCOGS(99999999);

      const debitos = lineas.reduce((s, l) => s + l.debito, 0);
      const creditos = lineas.reduce((s, l) => s + l.credito, 0);
      expect(debitos).toBe(99999999);
      expect(creditos).toBe(99999999);
    });
  });

  describe("lineasNotaCredito - Devolución", () => {
    it("debe crear líneas balanceadas para NC con reembolso a caja", () => {
      const lineas = lineasNotaCredito({
        monto: 5000,
        tipoReembolso: "caja",
        metodoReembolso: "efectivo",
      });

      // 3 líneas: devolución neto + reverso IVA + caja
      expect(lineas).toHaveLength(3);

      const debitos  = Math.round(lineas.reduce((s, l) => s + l.debito,  0) * 100) / 100;
      const creditos = Math.round(lineas.reduce((s, l) => s + l.credito, 0) * 100) / 100;

      expect(debitos).toBe(5000);
      expect(creditos).toBe(5000);
    });

    it("debe usar cuenta Saldos a Favor para NC aplicada", () => {
      const lineas = lineasNotaCredito({
        monto: 3000,
        tipoReembolso: "saldo_a_favor",
      });

      const lineaSaldo = lineas.find(
        (l) => l.cuentaCodigo === CUENTAS.SALDOS_FAVOR.codigo
      );
      expect(lineaSaldo?.credito).toBe(3000);
    });
  });

  describe("lineasCompra - Orden de Compra", () => {
    it("debe crear líneas balanceadas para compra a proveedor", () => {
      const lineas = lineasCompra({
        montoNeto: 5000,
        iva: 950,
        total: 5950,
      });

      expect(lineas).toHaveLength(3);

      const debitos = lineas.reduce((s, l) => s + l.debito, 0);
      const creditos = lineas.reduce((s, l) => s + l.credito, 0);

      expect(debitos).toBe(5950);
      expect(creditos).toBe(5950);
    });

    it("debe registrar IVA como crédito fiscal (cuenta ACTIVO, no PASIVO)", () => {
      const lineas = lineasCompra({
        montoNeto: 10000,
        iva: 1900,
        total: 11900,
      });

      // IVA en compras → cuenta de activo (crédito fiscal recuperable del SII)
      const lineaIVA = lineas.find(
        (l) => l.cuentaCodigo === CUENTAS.IVA_CREDITO_FISCAL.codigo
      );
      expect(lineaIVA).toBeDefined();
      expect(lineaIVA?.debito).toBe(1900);
      expect(lineaIVA?.credito).toBe(0);

      // NO debe usar la cuenta de IVA por Pagar (pasivo de ventas)
      const lineaIVAPagar = lineas.find(
        (l) => l.cuentaCodigo === CUENTAS.IVA_PAGAR.codigo
      );
      expect(lineaIVAPagar).toBeUndefined();
    });

    it("debe registrar cuenta por pagar a proveedor", () => {
      const lineas = lineasCompra({
        montoNeto: 8000,
        iva: 1520,
        total: 9520,
      });

      const lineaProveedor = lineas.find(
        (l) => l.cuentaCodigo === CUENTAS.PROVEEDORES.codigo
      );
      expect(lineaProveedor?.credito).toBe(9520);
    });
  });

  describe("lineasPagoProveedor - Pago a Proveedor", () => {
    it("debe crear líneas balanceadas para pago", () => {
      const lineas = lineasPagoProveedor(5950);

      expect(lineas).toHaveLength(2);

      const debitos = lineas.reduce((s, l) => s + l.debito, 0);
      const creditos = lineas.reduce((s, l) => s + l.credito, 0);

      expect(debitos).toBe(5950);
      expect(creditos).toBe(5950);
    });

    it("debe usar cuenta Banco para el crédito (default)", () => {
      const lineas = lineasPagoProveedor(10000);

      const lineaBanco = lineas.find(
        (l) => l.cuentaCodigo === CUENTAS.BANCO.codigo
      );
      expect(lineaBanco?.credito).toBe(10000);
    });

    // U-114
    it("U-114: metodoPago=efectivo → credita CAJA", () => {
      const lineas = lineasPagoProveedor(5000, "efectivo");
      const lineaCaja = lineas.find(l => l.cuentaCodigo === CUENTAS.CAJA.codigo);
      expect(lineaCaja?.credito).toBe(5000);
      const noBanco = lineas.find(l => l.cuentaCodigo === CUENTAS.BANCO.codigo);
      expect(noBanco).toBeUndefined();
    });

    // U-115
    it("U-115: metodoPago=transferencia → credita BANCO", () => {
      const lineas = lineasPagoProveedor(8000, "transferencia");
      const lineaBanco = lineas.find(l => l.cuentaCodigo === CUENTAS.BANCO.codigo);
      expect(lineaBanco?.credito).toBe(8000);
    });
  });

  describe("lineasCierreCOGS - Cierre de Mes", () => {
    it("debe crear líneas balanceadas para asiento de COGS", () => {
      const lineas = lineasCierreCOGS(150000);

      expect(lineas).toHaveLength(2);

      const debitos = lineas.reduce((s, l) => s + l.debito, 0);
      const creditos = lineas.reduce((s, l) => s + l.credito, 0);

      expect(debitos).toBe(150000);
      expect(creditos).toBe(150000);
    });

    it("debe debitar cuenta de COSTO", () => {
      const lineas = lineasCierreCOGS(50000);

      const lineaCOGS = lineas.find(
        (l) => l.cuentaCodigo === CUENTAS.COGS.codigo
      );
      expect(lineaCOGS?.debito).toBe(50000);
    });

    it("debe creditar cuenta de INVENTARIO", () => {
      const lineas = lineasCierreCOGS(75000);

      const lineaInventario = lineas.find(
        (l) => l.cuentaCodigo === CUENTAS.INVENTARIO.codigo
      );
      expect(lineaInventario?.credito).toBe(75000);
    });
  });

  describe("Validación de totales", () => {
    it("lineasVenta debe siempre estar balanceado", () => {
      const amounts = [
        { monto: 1000, iva: 190, total: 1190 },
        { monto: 5000, iva: 950, total: 5950 },
        { monto: 10000, iva: 1900, total: 11900 },
        { monto: 50000, iva: 9500, total: 59500 },
      ];

      amounts.forEach(({ monto, iva, total }) => {
        const lineas = lineasVenta({
          metodoPago: "efectivo",
          montoNeto: monto,
          iva: iva,
          total: total,
        });

        const debitos = lineas.reduce((s, l) => s + l.debito, 0);
        const creditos = lineas.reduce((s, l) => s + l.credito, 0);

        expect(debitos).toBe(creditos);
      });
    });

    it("lineasNotaCredito debe siempre estar balanceado", () => {
      const amounts = [1000, 2500, 5000, 10000];

      amounts.forEach((monto) => {
        const lineasCaja = lineasNotaCredito({
          monto,
          tipoReembolso: "caja",
        });
        const lineasSaldo = lineasNotaCredito({
          monto,
          tipoReembolso: "saldo_a_favor",
        });

        [lineasCaja, lineasSaldo].forEach((lineas) => {
          const debitos = lineas.reduce((s, l) => s + l.debito, 0);
          const creditos = lineas.reduce((s, l) => s + l.credito, 0);
          expect(debitos).toBe(creditos);
        });
      });
    });

    it("lineasCompra debe siempre estar balanceado", () => {
      const amounts = [
        { monto: 1000, iva: 190, total: 1190 },
        { monto: 8000, iva: 1520, total: 9520 },
        { monto: 50000, iva: 9500, total: 59500 },
      ];

      amounts.forEach(({ monto, iva, total }) => {
        const lineas = lineasCompra({
          montoNeto: monto,
          iva: iva,
          total: total,
        });

        const debitos = lineas.reduce((s, l) => s + l.debito, 0);
        const creditos = lineas.reduce((s, l) => s + l.credito, 0);

        expect(debitos).toBe(creditos);
      });
    });
  });
});

describe("CUENTAS - Plan de Cuentas", () => {
  it("debe tener códigos de cuenta válidos de 6 dígitos", () => {
    expect(CUENTAS.CAJA.codigo).toMatch(/^\d{6}$/);
    expect(CUENTAS.BANCO.codigo).toMatch(/^\d{6}$/);
    expect(CUENTAS.VENTAS.codigo).toMatch(/^\d{6}$/);
    expect(CUENTAS.PROVEEDORES.codigo).toMatch(/^\d{6}$/);
  });

  it("debe tener tipos de cuenta válidos", () => {
    const tiposValidos = ["ACTIVO", "PASIVO", "INGRESO", "GASTO"];

    Object.values(CUENTAS).forEach((cuenta) => {
      expect(tiposValidos).toContain(cuenta.tipo);
    });
  });

  // U-128: REGRESIÓN — Saldos a Favor Clientes es PASIVO (antes ACTIVO).
  // Representa una obligación de la tienda hacia los clientes (notas de crédito
  // pendientes de usar), no un recurso. Su saldo neto es típicamente negativo
  // (más créditos que débitos), que en ACTIVO es confuso en reportes.
  // Ver ticket Trello 6a5e9486a242880262f9556f.
  it("U-128: SALDOS_FAVOR es PASIVO, no ACTIVO", () => {
    expect(CUENTAS.SALDOS_FAVOR.tipo).toBe("PASIVO");
    expect(CUENTAS.SALDOS_FAVOR.tipo).not.toBe("ACTIVO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESIÓN I-ANV: lineasAnulacionVentaCanal / lineasAnulacionCOGS
// Bug: el PATCH /api/ventas/[id] anulaba la venta sin crear contra-asiento en
// el Libro Diario, dejando el ingreso registrado sin su reverso.
// ─────────────────────────────────────────────────────────────────────────────
describe("lineasAnulacionVentaCanal — reverso de asiento de venta", () => {
  const PARAMS = { canal: "pos", metodoPago: "efectivo", montoNeto: 8000, iva: 1520, total: 9520 };

  it("I-ANV-01: asiento balanceado (débito = crédito)", () => {
    const lineas = lineasAnulacionVentaCanal(PARAMS);
    const totalDeb = lineas.reduce((s, l) => s + l.debito, 0);
    const totalCre = lineas.reduce((s, l) => s + l.credito, 0);
    expect(totalDeb).toBe(totalCre);
    expect(totalDeb).toBe(PARAMS.total);
  });

  it("I-ANV-02: reverso usa Dr Ventas (ingreso queda en débito)", () => {
    const lineas = lineasAnulacionVentaCanal(PARAMS);
    const lineaVentas = lineas.find((l) => l.cuentaCodigo === CUENTAS.VENTAS.codigo);
    expect(lineaVentas).toBeDefined();
    expect(lineaVentas.debito).toBe(PARAMS.montoNeto);
    expect(lineaVentas.credito).toBe(0);
  });

  it("I-ANV-03: reverso usa Dr IVA por Pagar", () => {
    const lineas = lineasAnulacionVentaCanal(PARAMS);
    const lineaIva = lineas.find((l) => l.cuentaCodigo === CUENTAS.IVA_PAGAR.codigo);
    expect(lineaIva).toBeDefined();
    expect(lineaIva.debito).toBe(PARAMS.iva);
    expect(lineaIva.credito).toBe(0);
  });

  it("I-ANV-04: reverso usa Cr Caja para efectivo (pos)", () => {
    const lineas = lineasAnulacionVentaCanal(PARAMS);
    const lineaCaja = lineas.find((l) => l.cuentaCodigo === CUENTAS.CAJA.codigo);
    expect(lineaCaja).toBeDefined();
    expect(lineaCaja.debito).toBe(0);
    expect(lineaCaja.credito).toBe(PARAMS.total);
  });

  it("I-ANV-05: reverso usa Cr Banco para métodos digitales", () => {
    const lineas = lineasAnulacionVentaCanal({ ...PARAMS, metodoPago: "debito" });
    const lineaBanco = lineas.find((l) => l.cuentaCodigo === CUENTAS.BANCO.codigo);
    expect(lineaBanco).toBeDefined();
    expect(lineaBanco.credito).toBe(PARAMS.total);
  });

  it("I-ANV-06: reverso usa Cr CxC Rappi para canal rappi", () => {
    const lineas = lineasAnulacionVentaCanal({ ...PARAMS, canal: "rappi" });
    const lineaRappi = lineas.find((l) => l.cuentaCodigo === CUENTAS.CXC_RAPPI.codigo);
    expect(lineaRappi).toBeDefined();
    expect(lineaRappi.credito).toBe(PARAMS.total);
  });

  it("I-ANV-07: es el inverso exacto de lineasVentaCanal (débitos ↔ créditos)", () => {
    const { lineasVentaCanal } = require("@/lib/contabilidad/generador-asientos");
    const ventaLineas = lineasVentaCanal(PARAMS);
    const anulLineas  = lineasAnulacionVentaCanal(PARAMS);

    // Para cada cuenta del asiento de venta, el asiento de anulación
    // debe tener los valores de débito y crédito intercambiados.
    for (const lineaVenta of ventaLineas) {
      const lineaAnul = anulLineas.find((l) => l.cuentaCodigo === lineaVenta.cuentaCodigo);
      expect(lineaAnul).toBeDefined();
      expect(lineaAnul.debito).toBe(lineaVenta.credito);
      expect(lineaAnul.credito).toBe(lineaVenta.debito);
    }
  });
});

describe("lineasAnulacionCOGS — reverso de costo de venta", () => {
  it("I-ANV-08: asiento balanceado", () => {
    const lineas = lineasAnulacionCOGS(5000);
    const totalDeb = lineas.reduce((s, l) => s + l.debito, 0);
    const totalCre = lineas.reduce((s, l) => s + l.credito, 0);
    expect(totalDeb).toBe(totalCre);
    expect(totalDeb).toBe(5000);
  });

  it("I-ANV-09: Dr Inventario (reincorporación al stock)", () => {
    const lineas = lineasAnulacionCOGS(5000);
    const lineaInv = lineas.find((l) => l.cuentaCodigo === CUENTAS.INVENTARIO.codigo);
    expect(lineaInv).toBeDefined();
    expect(lineaInv.debito).toBe(5000);
    expect(lineaInv.credito).toBe(0);
  });

  it("I-ANV-10: Cr COGS (reverso del gasto)", () => {
    const lineas = lineasAnulacionCOGS(5000);
    const lineaCogs = lineas.find((l) => l.cuentaCodigo === CUENTAS.COGS.codigo);
    expect(lineaCogs).toBeDefined();
    expect(lineaCogs.debito).toBe(0);
    expect(lineaCogs.credito).toBe(5000);
  });

  it("I-ANV-11: es el inverso exacto de lineasVentaCOGS", () => {
    const cogsLineas  = lineasVentaCOGS(5000);
    const anulLineas  = lineasAnulacionCOGS(5000);
    for (const lineaCOGS of cogsLineas) {
      const lineaAnul = anulLineas.find((l) => l.cuentaCodigo === lineaCOGS.cuentaCodigo);
      expect(lineaAnul).toBeDefined();
      expect(lineaAnul.debito).toBe(lineaCOGS.credito);
      expect(lineaAnul.credito).toBe(lineaCOGS.debito);
    }
  });
});

describe("lineasNotaCreditoCOGS — reverso de costo por devolución", () => {
  it("I-NCC-01: asiento balanceado", () => {
    const lineas = lineasNotaCreditoCOGS(5000);
    const totalDeb = lineas.reduce((s, l) => s + l.debito, 0);
    const totalCre = lineas.reduce((s, l) => s + l.credito, 0);
    expect(totalDeb).toBe(totalCre);
    expect(totalDeb).toBe(5000);
  });

  it("I-NCC-02: Dr Inventario (reincorporación al stock)", () => {
    const lineas = lineasNotaCreditoCOGS(5000);
    const lineaInv = lineas.find((l) => l.cuentaCodigo === CUENTAS.INVENTARIO.codigo);
    expect(lineaInv).toBeDefined();
    expect(lineaInv.debito).toBe(5000);
    expect(lineaInv.credito).toBe(0);
  });

  it("I-NCC-03: Cr COGS (reverso del gasto)", () => {
    const lineas = lineasNotaCreditoCOGS(5000);
    const lineaCogs = lineas.find((l) => l.cuentaCodigo === CUENTAS.COGS.codigo);
    expect(lineaCogs).toBeDefined();
    expect(lineaCogs.debito).toBe(0);
    expect(lineaCogs.credito).toBe(5000);
  });

  it("I-NCC-04: es el inverso exacto de lineasVentaCOGS", () => {
    const cogsLineas = lineasVentaCOGS(5000);
    const ncLineas = lineasNotaCreditoCOGS(5000);
    for (const lineaCOGS of cogsLineas) {
      const lineaNc = ncLineas.find((l) => l.cuentaCodigo === lineaCOGS.cuentaCodigo);
      expect(lineaNc).toBeDefined();
      expect(lineaNc.debito).toBe(lineaCOGS.credito);
      expect(lineaNc.credito).toBe(lineaCOGS.debito);
    }
  });

  it("I-NCC-05: funciona con costo cero", () => {
    const lineas = lineasNotaCreditoCOGS(0);
    const totalDeb = lineas.reduce((s, l) => s + l.debito, 0);
    const totalCre = lineas.reduce((s, l) => s + l.credito, 0);
    expect(totalDeb).toBe(0);
    expect(totalCre).toBe(0);
  });
});
