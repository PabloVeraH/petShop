import * as XLSX from "xlsx";

export interface PrediccionReportData {
  producto_nombre: string;
  sku: string;
  tendencia: string;
  confianza: number;
  prediccion: number[];
  estacionalidad: string[];
}

export interface ReorderReportData {
  producto_nombre: string;
  sku: string;
  stock_actual: number;
  stock_minimo: number;
  demanda_promedio: number;
  cantidad_sugerida: number;
  urgencia: string;
  proveedor_nombre: string;
  tiempo_entrega: number;
  razon: string;
}

export function generatePrediccionExcel(data: PrediccionReportData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const resumen = [
    ["Reporte de Prediccion de Demanda"],
    [""],
    ["Producto", data.producto_nombre],
    ["SKU", data.sku],
    ["Tendencia", data.tendencia],
    ["Confianza", `${Math.round(data.confianza * 100)}%`],
    ["Dias pico", data.estacionalidad.join(", ")],
    ["Total predicho (30 dias)", data.prediccion.reduce((a, b) => a + b, 0)],
  ];

  const resumenWS = XLSX.utils.aoa_to_sheet(resumen);
  XLSX.utils.book_append_sheet(wb, resumenWS, "Resumen");

  const prediccionRows: (string | number)[][] = [["Dia", "Unidades predichas"]];
  data.prediccion.forEach((cant, i) => {
    prediccionRows.push([i + 1, Math.round(cant)]);
  });
  const prediccionWS = XLSX.utils.aoa_to_sheet(prediccionRows);
  XLSX.utils.book_append_sheet(wb, prediccionWS, "Proyeccion");

  return wb;
}

export function generateReorderExcel(sugerencias: ReorderReportData[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const headers = [
    "Producto",
    "SKU",
    "Stock Actual",
    "Stock Minimo",
    "Demanda Promedio",
    "Cantidad Sugerida",
    "Urgencia",
    "Proveedor",
    "Tiempo Entrega (dias)",
    "Razon",
  ];

  const rows: (string | number)[][] = [headers];
  sugerencias.forEach((s) => {
    rows.push([
      s.producto_nombre,
      s.sku,
      s.stock_actual,
      s.stock_minimo,
      s.demanda_promedio,
      s.cantidad_sugerida,
      s.urgencia,
      s.proveedor_nombre,
      s.tiempo_entrega,
      s.razon,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Reorden");

  const urgenciaCount = { critica: 0, alta: 0, media: 0, baja: 0 };
  sugerencias.forEach((s) => {
    if (s.urgencia in urgenciaCount) {
      urgenciaCount[s.urgencia as keyof typeof urgenciaCount]++;
    }
  });

  const resumen: (string | number)[][] = [
    ["Resumen de Sugerencias"],
    [""],
    ["Criticas", urgenciaCount.critica],
    ["Altas", urgenciaCount.alta],
    ["Media", urgenciaCount.media],
    ["Baja", urgenciaCount.baja],
    ["Total", sugerencias.length],
  ];
  const resumenWS = XLSX.utils.aoa_to_sheet(resumen);
  XLSX.utils.book_append_sheet(wb, resumenWS, "Resumen Reorden");

  return wb;
}

export function generateFullReportExcel(
  prediccion: PrediccionReportData | null,
  reorder: ReorderReportData[]
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  if (prediccion) {
    const prediccionSheets = generatePrediccionExcel(prediccion);
    prediccionSheets.SheetNames.forEach((name) => {
      XLSX.utils.book_append_sheet(wb, prediccionSheets.Sheets[name], name);
    });
  }

  if (reorder.length > 0) {
    const reorderSheets = generateReorderExcel(reorder);
    reorderSheets.SheetNames.forEach((name) => {
      XLSX.utils.book_append_sheet(wb, reorderSheets.Sheets[name], name);
    });
  }

  return wb;
}