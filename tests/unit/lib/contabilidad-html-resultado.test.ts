import { generarHtmlEstadoResultado, EstadoResultadoHTMLData } from "@/lib/contabilidad/html-estado-resultado";

const BASE_DATA: EstadoResultadoHTMLData = {
  periodo: "abril 2026",
  fecha_elaboracion: "2026-04-30",
  empresa: { nombre: "petShop SpA", rut: "76.577.662-9" },
  ingresos: {
    venta_productos: 1000000,
    devoluciones: -50000,
    total_ingresos_operacionales: 950000,
  },
  gastos: {
    costo_venta: 600000,
    total_gastos: 600000,
  },
  utilidad_bruta: 350000,
  utilidad_neta: 350000,
};

describe("ER-01: generarHtmlEstadoResultado", () => {
  it("ER-01: retorna un string HTML válido", () => {
    const html = generarHtmlEstadoResultado(BASE_DATA);
    expect(typeof html).toBe("string");
    expect(html).toMatch(/<!DOCTYPE html>/i);
    expect(html).toMatch(/<\/html>/i);
  });

  it("ER-02: incluye nombre de empresa y RUT", () => {
    const html = generarHtmlEstadoResultado(BASE_DATA);
    expect(html).toContain("petShop SpA");
    expect(html).toContain("76.577.662-9");
  });

  it("ER-03: incluye título Estado de Resultado", () => {
    const html = generarHtmlEstadoResultado(BASE_DATA);
    expect(html).toContain("Estado de Resultado");
  });

  it("ER-04: incluye período", () => {
    const html = generarHtmlEstadoResultado(BASE_DATA);
    expect(html).toContain("abril 2026");
  });

  it("ER-05: incluye ingresos, gastos y utilidad", () => {
    const html = generarHtmlEstadoResultado(BASE_DATA);
    expect(html).toContain("Venta de Productos");
    expect(html).toContain("Devoluciones en Ventas");
    expect(html).toContain("Total Ingresos Operacionales");
    expect(html).toContain("Costo de Bienes Vendidos");
    expect(html).toContain("Total Gastos");
  });

  it("ER-06: montos formateados en CLP", () => {
    const html = generarHtmlEstadoResultado(BASE_DATA);
    expect(html).toContain("$1.000.000");
    expect(html).toContain("$950.000");
    expect(html).toContain("$600.000");
    expect(html).toContain("$350.000");
  });

  it("ER-07: utilidad positiva muestra UTILIDAD NETA en verde", () => {
    const html = generarHtmlEstadoResultado(BASE_DATA);
    expect(html).toContain("UTILIDAD NETA");
    expect(html).toContain("pos");
  });

  it("ER-08: pérdida muestra PÉRDIDA en rojo", () => {
    const data: EstadoResultadoHTMLData = {
      ...BASE_DATA,
      ingresos: { venta_productos: 100000, devoluciones: 0, total_ingresos_operacionales: 100000 },
      gastos: { costo_venta: 150000, total_gastos: 150000 },
      utilidad_bruta: -50000,
      utilidad_neta: -50000,
    };
    const html = generarHtmlEstadoResultado(data);
    expect(html).toContain("PÉRDIDA");
    expect(html).toContain("neg");
  });

  it("ER-09: no muestra línea de devoluciones si es cero", () => {
    const data: EstadoResultadoHTMLData = {
      ...BASE_DATA,
      ingresos: { ...BASE_DATA.ingresos, devoluciones: 0 },
    };
    const html = generarHtmlEstadoResultado(data);
    expect(html).not.toContain("Devoluciones en Ventas");
  });

  it("ER-10: incluye botón de impresión y CSS @media print", () => {
    const html = generarHtmlEstadoResultado(BASE_DATA);
    expect(html).toContain("window.print()");
    expect(html).toContain("btn-print");
    expect(html).toContain("@media print");
    expect(html).toContain("@page");
  });

  it("ER-11: empresa sin RUT muestra guión", () => {
    const data: EstadoResultadoHTMLData = {
      ...BASE_DATA,
      empresa: { nombre: "Mi Tienda", rut: "" },
    };
    const html = generarHtmlEstadoResultado(data);
    expect(html).toContain("Mi Tienda");
    expect(html).toContain("RUT: —");
  });
});
