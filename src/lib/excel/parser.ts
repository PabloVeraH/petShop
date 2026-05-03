import * as XLSX from "xlsx";

export interface RawProductoRow {
  sku?: string;
  nombre?: string;
  precio?: unknown;
  costo?: unknown;
  stock?: unknown;
  stock_minimo?: unknown;
  marca?: string;
  peso_gramos?: unknown;
  codigo_barra?: string;
  categoria?: string;
  fecha_vencimiento?: string;
  _fila: number; // número de fila en el excel (base 2, sin contar header)
}

const HEADER_MAP: Record<string, keyof Omit<RawProductoRow, "_fila">> = {
  sku: "sku",
  nombre: "nombre",
  precio: "precio",
  costo: "costo",
  stock: "stock",
  stockminimo: "stock_minimo",
  stock_minimo: "stock_minimo",
  "stock minimo": "stock_minimo",
  "stock mínimo": "stock_minimo",
  marca: "marca",
  pesogramos: "peso_gramos",
  peso_gramos: "peso_gramos",
  "peso gramos": "peso_gramos",
  codigobarra: "codigo_barra",
  codigo_barra: "codigo_barra",
  "codigo barra": "codigo_barra",
  "código de barra": "codigo_barra",
  "código barra": "codigo_barra",
  categoria: "categoria",
  categoría: "categoria",
  fechavencimiento: "fecha_vencimiento",
  fecha_vencimiento: "fecha_vencimiento",
  "fecha vencimiento": "fecha_vencimiento",
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().trim().replace(/\s+/g, " ");
}

export function parseProductosXLSX(buffer: Buffer): RawProductoRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rawRows.length < 2) return [];

  const headerRow = (rawRows[0] as unknown[]).map((h) =>
    normalizeHeader(String(h ?? ""))
  );

  const rows: RawProductoRow[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const rawRow = rawRows[i] as unknown[];

    // Skip fully empty rows
    const hasContent = rawRow.some((cell) => cell !== "" && cell !== null && cell !== undefined);
    if (!hasContent) continue;

    const row: RawProductoRow = { _fila: i + 1 }; // +1 porque fila 1 es el header

    headerRow.forEach((header, colIdx) => {
      const field = HEADER_MAP[header];
      if (!field) return;
      const value = rawRow[colIdx];
      (row as Record<string, unknown>)[field] = value === "" ? undefined : value;
    });

    // Normalizar fecha si viene como objeto Date (xlsx con cellDates:true)
    if (row.fecha_vencimiento instanceof Date) {
      row.fecha_vencimiento = row.fecha_vencimiento.toISOString().split("T")[0];
    } else if (typeof row.fecha_vencimiento !== "undefined") {
      row.fecha_vencimiento = String(row.fecha_vencimiento).trim();
    }

    // Normalizar strings
    if (row.sku) row.sku = String(row.sku).trim();
    if (row.nombre) row.nombre = String(row.nombre).trim();
    if (row.marca) row.marca = String(row.marca).trim();
    if (row.codigo_barra) row.codigo_barra = String(row.codigo_barra).trim();
    if (row.categoria) row.categoria = String(row.categoria).trim();

    rows.push(row);
  }

  return rows;
}

export function generateTemplateXLSX(): Buffer {
  const wb = XLSX.utils.book_new();

  // Hoja 1: Productos
  const headers = [
    "SKU", "Nombre", "Precio", "Costo", "Stock", "StockMinimo",
    "Marca", "PesoGramos", "CodigoBarra", "Categoria", "FechaVencimiento",
  ];

  const ejemplos = [
    ["ALI-001", "Royal Canin Adult Perro 15kg", 45990, 32000, 20, 3, "Royal Canin", 15000, "7891000315507", "Alimentos", ""],
    ["ALI-002", "Whiskas Adulto Pollo 1kg", 4990, 3200, 50, 5, "Whiskas", 1000, "7613032359479", "Alimentos", ""],
    ["ACC-001", "Collar Ajustable Talla M", 3990, 2000, 15, 2, "PetComfort", "", "9506000134376", "Accesorios", ""],
  ];

  const wsData = [headers, ...ejemplos];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Ancho de columnas
  ws["!cols"] = [
    { wch: 12 }, { wch: 35 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 12 },
    { wch: 15 }, { wch: 12 }, { wch: 16 }, { wch: 15 }, { wch: 18 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Productos");

  // Hoja 2: Instrucciones
  const instrucciones = [
    ["INSTRUCCIONES DE USO"],
    [""],
    ["Columnas obligatorias: SKU, Nombre, Precio"],
    ["Todas las demás columnas son opcionales."],
    [""],
    ["COLUMNA", "DESCRIPCIÓN", "EJEMPLO"],
    ["SKU", "Código único del producto (obligatorio)", "ALI-001"],
    ["Nombre", "Nombre del producto (obligatorio)", "Royal Canin Adult 15kg"],
    ["Precio", "Precio de venta con IVA (obligatorio)", "45990"],
    ["Costo", "Costo de compra sin IVA (opcional)", "32000"],
    ["Stock", "Cantidad en inventario (opcional, default 0)", "20"],
    ["StockMinimo", "Stock mínimo antes de alerta (opcional, default 5)", "3"],
    ["Marca", "Nombre de la marca (opcional)", "Royal Canin"],
    ["PesoGramos", "Peso del producto en gramos (opcional)", "15000"],
    ["CodigoBarra", "Código de barras EAN/UPC (opcional)", "7891000315507"],
    ["Categoria", "Nombre de la categoría (opcional, se crea si no existe)", "Alimentos"],
    ["FechaVencimiento", "Formato YYYY-MM-DD (opcional)", "2026-12-31"],
    [""],
    ["NOTAS IMPORTANTES"],
    ["- El SKU no puede repetirse. Las filas con SKU duplicado serán reportadas como error."],
    ["- Si el código de barra ya existe en la tienda, la fila será reportada como error."],
    ["- Las categorías se crean automáticamente si no existen."],
    ["- Elimina las filas de ejemplo antes de importar tus productos."],
    ["- Máximo 500 productos por importación."],
  ];

  const wsInstr = XLSX.utils.aoa_to_sheet(instrucciones);
  wsInstr["!cols"] = [{ wch: 20 }, { wch: 55 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, "Instrucciones");

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
