import { generarHtmlLibroDiario, LibroDiarioHTMLData } from "@/lib/contabilidad/html-libro-diario";

const BASE_DATA: LibroDiarioHTMLData = {
  periodo: "abril 2026",
  desde: "2026-04-01",
  hasta: "2026-04-30",
  fecha_elaboracion: "2026-04-30",
  empresa: { nombre: "petShop SpA", rut: "76.577.662-9" },
  asientos: [
    {
      numero_asiento: 1,
      fecha: "2026-04-01",
      tipo_movimiento: "VENTA",
      referencia_numero: "VTA-001",
      descripcion: "Venta efectivo cliente Juan Pérez",
      total_debito: 11900,
      total_credito: 11900,
      esta_balanceado: true,
      detalles: [
        { cuenta_codigo: "110101", cuenta_nombre: "Caja Operacional", debito: 10000, credito: 0 },
        { cuenta_codigo: "210501", cuenta_nombre: "IVA por Pagar", debito: 1900, credito: 0 },
        { cuenta_codigo: "410101", cuenta_nombre: "Venta de Productos", debito: 0, credito: 11900 },
      ],
    },
    {
      numero_asiento: 2,
      fecha: "2026-04-02",
      tipo_movimiento: "COMPRA",
      referencia_numero: "OC-001",
      descripcion: "Compra mercadería proveedor",
      total_debito: 5950,
      total_credito: 5950,
      esta_balanceado: true,
      detalles: [],
    },
  ],
  resumen: {
    total_asientos: 2,
    total_debitos: 17850,
    total_creditos: 17850,
    balanceado: true,
  },
};

describe("generarHtmlLibroDiario", () => {
  it("retorna un string HTML válido", () => {
    const html = generarHtmlLibroDiario(BASE_DATA);
    expect(typeof html).toBe("string");
    expect(html).toMatch(/<!DOCTYPE html>/i);
    expect(html).toMatch(/<\/html>/i);
  });

  it("incluye el nombre de la empresa y RUT", () => {
    const html = generarHtmlLibroDiario(BASE_DATA);
    expect(html).toContain("petShop SpA");
    expect(html).toContain("76.577.662-9");
  });

  it("incluye el período", () => {
    const html = generarHtmlLibroDiario(BASE_DATA);
    expect(html).toContain("abril 2026");
  });

  it("incluye las descripciones de los asientos", () => {
    const html = generarHtmlLibroDiario(BASE_DATA);
    expect(html).toContain("Venta efectivo cliente Juan Pérez");
    expect(html).toContain("Compra mercadería proveedor");
  });

  it("incluye los números de referencia", () => {
    const html = generarHtmlLibroDiario(BASE_DATA);
    expect(html).toContain("VTA-001");
    expect(html).toContain("OC-001");
  });

  it("incluye los tipos de movimiento", () => {
    const html = generarHtmlLibroDiario(BASE_DATA);
    expect(html).toContain("VENTA");
    expect(html).toContain("COMPRA");
  });

  it("incluye los montos formateados en pesos CLP", () => {
    const html = generarHtmlLibroDiario(BASE_DATA);
    expect(html).toContain("$11.900");
    expect(html).toContain("$5.950");
    expect(html).toContain("$17.850");
  });

  it("muestra indicador de balance cuadrado", () => {
    const html = generarHtmlLibroDiario(BASE_DATA);
    expect(html).toContain('class="bal balance-ok"');
    expect(html).not.toContain('class="bal balance-err"');
  });

  it("muestra indicador de balance descuadrado cuando no cuadra", () => {
    const data: LibroDiarioHTMLData = {
      ...BASE_DATA,
      resumen: { ...BASE_DATA.resumen, balanceado: false },
    };
    const html = generarHtmlLibroDiario(data);
    expect(html).toContain('class="bal balance-err"');
    expect(html).not.toContain('class="bal balance-ok"');
  });

  it("incluye el botón de impresión", () => {
    const html = generarHtmlLibroDiario(BASE_DATA);
    expect(html).toContain("window.print()");
    expect(html).toContain("btn-print");
  });

  it("incluye CSS para impresión (@media print)", () => {
    const html = generarHtmlLibroDiario(BASE_DATA);
    expect(html).toContain("@media print");
    expect(html).toContain("@page");
  });

  it("incluye las líneas de detalle de cada asiento", () => {
    const html = generarHtmlLibroDiario(BASE_DATA);
    expect(html).toContain("110101");
    expect(html).toContain("Caja Operacional");
    expect(html).toContain("210501");
    expect(html).toContain("IVA por Pagar");
    expect(html).toContain("410101");
    expect(html).toContain("Venta de Productos");
  });

  it("muestra mensaje cuando no hay asientos", () => {
    const data: LibroDiarioHTMLData = {
      ...BASE_DATA,
      asientos: [],
      resumen: { total_asientos: 0, total_debitos: 0, total_creditos: 0, balanceado: true },
    };
    const html = generarHtmlLibroDiario(data);
    expect(html).toContain("Sin asientos en este período");
  });

  it("formatea montos en cero correctamente", () => {
    const data: LibroDiarioHTMLData = {
      ...BASE_DATA,
      asientos: [],
      resumen: { total_asientos: 0, total_debitos: 0, total_creditos: 0, balanceado: true },
    };
    const html = generarHtmlLibroDiario(data);
    expect(html).toContain("$0");
  });

  it("maneja empresa sin RUT", () => {
    const data: LibroDiarioHTMLData = {
      ...BASE_DATA,
      empresa: { nombre: "Mi Tienda", rut: "" },
    };
    const html = generarHtmlLibroDiario(data);
    expect(html).toContain("Mi Tienda");
    expect(html).toContain("RUT: —");
  });

  it("incluye número de asiento de cada entrada", () => {
    const html = generarHtmlLibroDiario(BASE_DATA);
    expect(html).toContain(">1<");
    expect(html).toContain(">2<");
  });

  it("incluye total de asientos en footer", () => {
    const html = generarHtmlLibroDiario(BASE_DATA);
    expect(html).toContain("Total asientos: 2");
  });
});
