/**
 * Tests U-01 a U-06: parseProductosXLSX
 */
import * as XLSX from "xlsx";
import { parseProductosXLSX, generateTemplateXLSX } from "@/lib/excel/parser";

function makeXLSX(headers: string[], rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe("parseProductosXLSX — mapeo de headers", () => {
  // U-01
  it("U-01: mapea headers exactos correctamente", () => {
    const buf = makeXLSX(
      ["SKU", "Nombre", "Precio", "Stock"],
      [["SKU-001", "Producto A", 9990, 10]]
    );
    const rows = parseProductosXLSX(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sku: "SKU-001", nombre: "Producto A", precio: 9990, stock: 10, _fila: 2 });
  });

  // U-02
  it("U-02: mapea headers case-insensitive (minúsculas)", () => {
    const buf = makeXLSX(
      ["sku", "nombre", "precio"],
      [["SKU-002", "Producto B", 4990]]
    );
    const rows = parseProductosXLSX(buf);
    expect(rows[0]).toMatchObject({ sku: "SKU-002", nombre: "Producto B", precio: 4990 });
  });

  // U-03
  it("U-03: mapea variantes de nombre con espacios (Stock Minimo → stock_minimo)", () => {
    const buf = makeXLSX(
      ["SKU", "Nombre", "Precio", "Stock Minimo"],
      [["SKU-003", "Producto C", 1990, 3]]
    );
    const rows = parseProductosXLSX(buf);
    expect(rows[0].stock_minimo).toBe(3);
  });

  // U-04
  it("U-04: mapea Categoria y FechaVencimiento", () => {
    const buf = makeXLSX(
      ["SKU", "Nombre", "Precio", "Categoria", "FechaVencimiento"],
      [["SKU-004", "Producto D", 2990, "Alimentos", "2026-12-31"]]
    );
    const rows = parseProductosXLSX(buf);
    expect(rows[0].categoria).toBe("Alimentos");
    expect(rows[0].fecha_vencimiento).toBe("2026-12-31");
  });
});

describe("parseProductosXLSX — manejo de filas", () => {
  // U-05
  it("U-05: ignora filas completamente vacías", () => {
    const buf = makeXLSX(
      ["SKU", "Nombre", "Precio"],
      [
        ["SKU-001", "Producto A", 9990],
        ["", "", ""],       // fila vacía
        ["SKU-002", "Producto B", 4990],
      ]
    );
    const rows = parseProductosXLSX(buf);
    expect(rows).toHaveLength(2);
  });

  // U-06
  it("U-06: asigna número de fila correcto (base 2, header es fila 1)", () => {
    const buf = makeXLSX(
      ["SKU", "Nombre", "Precio"],
      [
        ["SKU-001", "Producto A", 9990],  // fila 2
        ["SKU-002", "Producto B", 4990],  // fila 3
      ]
    );
    const rows = parseProductosXLSX(buf);
    expect(rows[0]._fila).toBe(2);
    expect(rows[1]._fila).toBe(3);
  });

  // U-07
  it("U-07: devuelve array vacío si el archivo solo tiene headers", () => {
    const buf = makeXLSX(["SKU", "Nombre", "Precio"], []);
    const rows = parseProductosXLSX(buf);
    expect(rows).toHaveLength(0);
  });

  // U-08
  it("U-08: trim de strings en sku, nombre, marca", () => {
    const buf = makeXLSX(
      ["SKU", "Nombre", "Precio", "Marca"],
      [["  SKU-001  ", "  Producto A  ", 9990, "  MarcaX  "]]
    );
    const rows = parseProductosXLSX(buf);
    expect(rows[0].sku).toBe("SKU-001");
    expect(rows[0].nombre).toBe("Producto A");
    expect(rows[0].marca).toBe("MarcaX");
  });
});

describe("generateTemplateXLSX", () => {
  // U-09
  it("U-09: genera un buffer xlsx válido", () => {
    const buf = generateTemplateXLSX();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  // U-10
  it("U-10: el template tiene las columnas esperadas en la primera hoja", () => {
    const buf = generateTemplateXLSX();
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { header: 1 });
    const headers = rows[0] as string[];
    expect(headers).toContain("SKU");
    expect(headers).toContain("Nombre");
    expect(headers).toContain("Precio");
    expect(headers).toContain("Categoria");
    expect(headers).toContain("FechaVencimiento");
  });

  // U-11
  it("U-11: el template tiene una hoja de Instrucciones", () => {
    const buf = generateTemplateXLSX();
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toContain("Instrucciones");
  });
});
