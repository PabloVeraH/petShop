const {
  lineasVenta,
  lineasNotaCredito,
  lineasCompra,
  lineasPagoProveedor,
  lineasCierreCOGS,
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

  describe("lineasNotaCredito - Devolución", () => {
    it("debe crear líneas balanceadas para NC con reembolso a caja", () => {
      const lineas = lineasNotaCredito({
        monto: 5000,
        tipoReembolso: "caja",
      });

      expect(lineas).toHaveLength(2);

      const debitos = lineas.reduce((s, l) => s + l.debito, 0);
      const creditos = lineas.reduce((s, l) => s + l.credito, 0);

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

    it("debe usar cuenta Banco para el crédito", () => {
      const lineas = lineasPagoProveedor(10000);

      const lineaBanco = lineas.find(
        (l) => l.cuentaCodigo === CUENTAS.BANCO.codigo
      );
      expect(lineaBanco?.credito).toBe(10000);
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
});