import { generarHtmlBalancePrueba, BalancePruebaHTMLData } from "@/lib/contabilidad/html-balance-prueba";

const BASE_DATA: BalancePruebaHTMLData = {
  periodo: "Hasta 2026-04-30",
  fecha: "2026-04-30",
  fecha_elaboracion: "2026-04-30",
  empresa: { nombre: "petShop SpA", rut: "76.577.662-9" },
  cuentas: [
    { codigo: "110101", nombre: "Caja Operacional", tipo: "Activo", debitos: 500000, creditos: 200000, saldo: 300000 },
    { codigo: "210501", nombre: "IVA por Pagar", tipo: "Pasivo", debitos: 0, creditos: 95000, saldo: -95000 },
    { codigo: "410101", nombre: "Venta de Productos", tipo: "Ingreso", debitos: 0, creditos: 500000, saldo: -500000 },
  ],
  resumen: {
    total_debitos: 500000,
    total_creditos: 795000,
    balanceado: false,
  },
};

describe("BP-01: generarHtmlBalancePrueba", () => {
  it("BP-01: retorna un string HTML válido", () => {
    const html = generarHtmlBalancePrueba(BASE_DATA);
    expect(typeof html).toBe("string");
    expect(html).toMatch(/<!DOCTYPE html>/i);
    expect(html).toMatch(/<\/html>/i);
  });

  it("BP-02: incluye nombre de empresa y RUT", () => {
    const html = generarHtmlBalancePrueba(BASE_DATA);
    expect(html).toContain("petShop SpA");
    expect(html).toContain("76.577.662-9");
  });

  it("BP-03: incluye título Balance de Comprobación", () => {
    const html = generarHtmlBalancePrueba(BASE_DATA);
    expect(html).toContain("Balance de Comprobación");
  });

  it("BP-04: incluye período y fecha", () => {
    const html = generarHtmlBalancePrueba(BASE_DATA);
    expect(html).toContain("Hasta 2026-04-30");
  });

  it("BP-05: incluye todas las cuentas con código, nombre, tipo, montos", () => {
    const html = generarHtmlBalancePrueba(BASE_DATA);
    expect(html).toContain("110101");
    expect(html).toContain("Caja Operacional");
    expect(html).toContain("Activo");
    expect(html).toContain("210501");
    expect(html).toContain("IVA por Pagar");
    expect(html).toContain("Pasivo");
    expect(html).toContain("410101");
    expect(html).toContain("Venta de Productos");
    expect(html).toContain("Ingreso");
  });

  it("BP-06: montos formateados en CLP", () => {
    const html = generarHtmlBalancePrueba(BASE_DATA);
    expect(html).toContain("$500.000");
    expect(html).toContain("$200.000");
    expect(html).toContain("$95.000");
  });

  it("BP-07: muestra mensaje cuando no hay cuentas", () => {
    const data: BalancePruebaHTMLData = {
      ...BASE_DATA,
      cuentas: [],
      resumen: { total_debitos: 0, total_creditos: 0, balanceado: true },
    };
    const html = generarHtmlBalancePrueba(data);
    expect(html).toContain("Sin movimientos en este período");
  });

  it("BP-08: incluye botón de impresión y CSS @media print", () => {
    const html = generarHtmlBalancePrueba(BASE_DATA);
    expect(html).toContain("window.print()");
    expect(html).toContain("btn-print");
    expect(html).toContain("@media print");
    expect(html).toContain("@page");
  });

  it("BP-09: muestra indicador descuadrado cuando no balancea", () => {
    const html = generarHtmlBalancePrueba(BASE_DATA);
    expect(html).toContain("ATENCIÓN");
    expect(html).toContain("descuadrado");
  });

  it("BP-10: muestra balanceado cuando Dr = Cr", () => {
    const data: BalancePruebaHTMLData = {
      ...BASE_DATA,
      resumen: { total_debitos: 500000, total_creditos: 500000, balanceado: true },
    };
    const html = generarHtmlBalancePrueba(data);
    expect(html).toContain("balanceado");
    expect(html).not.toContain("descuadrado");
  });

  it("BP-11: empresa sin RUT muestra guión", () => {
    const data: BalancePruebaHTMLData = {
      ...BASE_DATA,
      empresa: { nombre: "Mi Tienda", rut: "" },
    };
    const html = generarHtmlBalancePrueba(data);
    expect(html).toContain("Mi Tienda");
    expect(html).toContain("RUT: —");
  });

  it("BP-12: incluye totales en el pie", () => {
    const html = generarHtmlBalancePrueba(BASE_DATA);
    expect(html).toContain("$500.000");
    expect(html).toContain("$795.000");
  });
});
