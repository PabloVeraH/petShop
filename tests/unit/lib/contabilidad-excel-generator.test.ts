import * as XLSX from "xlsx";
import {
  generarExcelBalance,
  generarExcelEstadoResultado,
  generarExcelLibroDiario,
  CuentaBalance,
  EstadoResultadoData,
} from "@/lib/contabilidad/excel-generator";

const CUENTAS_BASE: CuentaBalance[] = [
  { codigo: "110101", nombre: "Caja Operacional", tipo: "ACTIVO", debitos: 100000, creditos: 30000, saldo: 70000 },
  { codigo: "210101", nombre: "Proveedores", tipo: "PASIVO", debitos: 5000, creditos: 50000, saldo: -45000 },
  { codigo: "410101", nombre: "Venta de Productos", tipo: "INGRESO", debitos: 0, creditos: 100000, saldo: -100000 },
];

const META_BASE = { periodo: "abril 2026", fecha: "2026-04-30", empresa: "petShop SpA", rut: "76.577.662-9" };

const RESULTADO_BASE: EstadoResultadoData = {
  periodo: "abril 2026",
  empresa: { nombre: "petShop SpA", rut: "76.577.662-9" },
  ingresos: {
    venta_productos: 480000,
    devoluciones: -12000,
    total_ingresos_operacionales: 468000,
    otros_ingresos: 5000,
  },
  gastos: {
    costo_venta: 230000,
    gastos_operacionales: 45000,
    gastos_financieros: 3000,
    total_gastos: 278000,
  },
  utilidad_bruta: 238000,
  utilidad_operacional: 190000,
  utilidad_neta: 190000,
};

function leerWorkbook(buffer: Buffer) {
  return XLSX.read(buffer, { type: "buffer" });
}

function leerHoja(wb: XLSX.WorkBook, nombre: string) {
  const ws = wb.Sheets[nombre];
  if (!ws) throw new Error(`Hoja "${nombre}" no encontrada. Hojas disponibles: ${wb.SheetNames.join(", ")}`);
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
}

describe("generarExcelBalance", () => {
  it("retorna un Buffer válido", () => {
    const buf = generarExcelBalance(CUENTAS_BASE, META_BASE);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("genera un archivo xlsx parseable", () => {
    const buf = generarExcelBalance(CUENTAS_BASE, META_BASE);
    expect(() => leerWorkbook(buf)).not.toThrow();
  });

  it("contiene la hoja 'Balance'", () => {
    const wb = leerWorkbook(generarExcelBalance(CUENTAS_BASE, META_BASE));
    expect(wb.SheetNames).toContain("Balance");
  });

  it("incluye el nombre de empresa en los datos", () => {
    const wb = leerWorkbook(generarExcelBalance(CUENTAS_BASE, META_BASE));
    const rows = leerHoja(wb, "Balance").flat().join(" ");
    expect(rows).toContain("petShop SpA");
  });

  it("incluye el RUT en los datos", () => {
    const wb = leerWorkbook(generarExcelBalance(CUENTAS_BASE, META_BASE));
    const rows = leerHoja(wb, "Balance").flat().join(" ");
    expect(rows).toContain("76.577.662-9");
  });

  it("incluye los códigos de cuenta", () => {
    const wb = leerWorkbook(generarExcelBalance(CUENTAS_BASE, META_BASE));
    const rows = leerHoja(wb, "Balance").flat().map(String);
    expect(rows).toContain("110101");
    expect(rows).toContain("210101");
    expect(rows).toContain("410101");
  });

  it("incluye los nombres de cuenta", () => {
    const wb = leerWorkbook(generarExcelBalance(CUENTAS_BASE, META_BASE));
    const rows = leerHoja(wb, "Balance").flat().join(" ");
    expect(rows).toContain("Caja Operacional");
    expect(rows).toContain("Proveedores");
    expect(rows).toContain("Venta de Productos");
  });

  it("incluye los montos numéricos correctos", () => {
    const wb = leerWorkbook(generarExcelBalance(CUENTAS_BASE, META_BASE));
    const rows = leerHoja(wb, "Balance").flat().map(Number).filter((n) => !isNaN(n));
    expect(rows).toContain(100000);
    expect(rows).toContain(30000);
    expect(rows).toContain(70000);
  });

  it("funciona con lista vacía de cuentas", () => {
    const buf = generarExcelBalance([], META_BASE);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("maneja empresa sin RUT", () => {
    const buf = generarExcelBalance(CUENTAS_BASE, { ...META_BASE, rut: "" });
    const wb = leerWorkbook(buf);
    const rows = leerHoja(wb, "Balance").flat().join(" ");
    expect(rows).toContain("—");
  });
});

describe("generarExcelEstadoResultado", () => {
  it("retorna un Buffer válido", () => {
    const buf = generarExcelEstadoResultado(RESULTADO_BASE);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("genera un archivo xlsx parseable", () => {
    const buf = generarExcelEstadoResultado(RESULTADO_BASE);
    expect(() => leerWorkbook(buf)).not.toThrow();
  });

  it("contiene la hoja 'Estado de Resultado'", () => {
    const wb = leerWorkbook(generarExcelEstadoResultado(RESULTADO_BASE));
    expect(wb.SheetNames).toContain("Estado de Resultado");
  });

  it("incluye el período", () => {
    const wb = leerWorkbook(generarExcelEstadoResultado(RESULTADO_BASE));
    const rows = leerHoja(wb, "Estado de Resultado").flat().join(" ");
    expect(rows).toContain("abril 2026");
  });

  it("incluye monto de ventas", () => {
    const wb = leerWorkbook(generarExcelEstadoResultado(RESULTADO_BASE));
    const nums = leerHoja(wb, "Estado de Resultado").flat().map(Number).filter((n) => !isNaN(n));
    expect(nums).toContain(480000);
  });

  it("incluye utilidad neta", () => {
    const wb = leerWorkbook(generarExcelEstadoResultado(RESULTADO_BASE));
    const nums = leerHoja(wb, "Estado de Resultado").flat().map(Number).filter((n) => !isNaN(n));
    expect(nums).toContain(190000);
  });

  it("incluye devoluciones cuando son distintas de 0", () => {
    const wb = leerWorkbook(generarExcelEstadoResultado(RESULTADO_BASE));
    const rows = leerHoja(wb, "Estado de Resultado").flat().join(" ");
    expect(rows).toContain("Devoluciones");
  });

  it("omite devoluciones cuando son 0", () => {
    const data: EstadoResultadoData = {
      ...RESULTADO_BASE,
      ingresos: { ...RESULTADO_BASE.ingresos, devoluciones: 0 },
    };
    const wb = leerWorkbook(generarExcelEstadoResultado(data));
    const rows = leerHoja(wb, "Estado de Resultado").flat().join(" ");
    expect(rows).not.toContain("Devoluciones");
  });
});

describe("generarExcelLibroDiario", () => {
  const ASIENTOS = [
    {
      numero_asiento: 1,
      fecha: "2026-04-01",
      tipo_movimiento: "VENTA",
      descripcion: "Venta efectivo",
      referencia_numero: "VTA-001",
      total_debito: 11900,
      total_credito: 11900,
      esta_balanceado: true,
    },
    {
      numero_asiento: 2,
      fecha: "2026-04-02",
      tipo_movimiento: "COMPRA",
      descripcion: "Compra mercadería",
      referencia_numero: "OC-001",
      total_debito: 5950,
      total_credito: 5950,
      esta_balanceado: true,
    },
  ];

  const META = { periodo: "abril 2026", empresa: "petShop SpA", rut: "76.577.662-9" };

  it("retorna un Buffer válido", () => {
    const buf = generarExcelLibroDiario(ASIENTOS, META);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("genera un archivo xlsx parseable", () => {
    const buf = generarExcelLibroDiario(ASIENTOS, META);
    expect(() => leerWorkbook(buf)).not.toThrow();
  });

  it("contiene la hoja 'Libro Diario'", () => {
    const wb = leerWorkbook(generarExcelLibroDiario(ASIENTOS, META));
    expect(wb.SheetNames).toContain("Libro Diario");
  });

  it("incluye las descripciones de asientos", () => {
    const wb = leerWorkbook(generarExcelLibroDiario(ASIENTOS, META));
    const rows = leerHoja(wb, "Libro Diario").flat().join(" ");
    expect(rows).toContain("Venta efectivo");
    expect(rows).toContain("Compra mercadería");
  });

  it("incluye los tipos de movimiento", () => {
    const wb = leerWorkbook(generarExcelLibroDiario(ASIENTOS, META));
    const rows = leerHoja(wb, "Libro Diario").flat().join(" ");
    expect(rows).toContain("VENTA");
    expect(rows).toContain("COMPRA");
  });

  it("incluye los montos", () => {
    const wb = leerWorkbook(generarExcelLibroDiario(ASIENTOS, META));
    const nums = leerHoja(wb, "Libro Diario").flat().map(Number).filter((n) => !isNaN(n) && n > 0);
    expect(nums).toContain(11900);
    expect(nums).toContain(5950);
  });

  it("funciona con lista vacía de asientos", () => {
    const buf = generarExcelLibroDiario([], META);
    expect(buf).toBeInstanceOf(Buffer);
  });
});
