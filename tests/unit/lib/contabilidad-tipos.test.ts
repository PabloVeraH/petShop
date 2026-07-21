const { getCuentaTipo, CUENTAS } = require("@/lib/contabilidad/types");

describe("getCuentaTipo — lookup helper", () => {
  it("U-129: retorna PASIVO para código 110502 (Saldos a Favor)", () => {
    expect(getCuentaTipo("110502")).toBe("PASIVO");
  });

  it("retorna ACTIVO para código 110101 (Caja)", () => {
    expect(getCuentaTipo("110101")).toBe("ACTIVO");
  });

  it("retorna PASIVO para código 210501 (IVA por Pagar)", () => {
    expect(getCuentaTipo("210501")).toBe("PASIVO");
  });

  it("retorna INGRESO para código 410101 (Venta de Productos)", () => {
    expect(getCuentaTipo("410101")).toBe("INGRESO");
  });

  it("retorna GASTO para código 510101 (COGS)", () => {
    expect(getCuentaTipo("510101")).toBe("GASTO");
  });

  it("U-130: usa fallback cuando el código no está en CUENTAS", () => {
    expect(getCuentaTipo("999999", "DESCONOCIDO")).toBe("DESCONOCIDO");
  });

  it("retorna string vacío por defecto cuando no hay match ni fallback", () => {
    expect(getCuentaTipo("999999")).toBe("");
  });

  it("resuelve todos los códigos de CUENTAS sin fallback", () => {
    Object.values(CUENTAS).forEach((cuenta: { codigo: string; tipo: string }) => {
      expect(getCuentaTipo(cuenta.codigo)).toBe(cuenta.tipo);
    });
  });

  it("fallback no interfiere con códigos existentes", () => {
    expect(getCuentaTipo("110502", "fallback")).toBe("PASIVO");
  });
});
