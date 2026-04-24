import jsPDF from "jspdf";

export interface PrediccionReportData {
  producto_nombre: string;
  sku: string;
  tendencia: string;
  confianza: number;
  prediccion: number[];
  estacionalidad: string[];
}

export function generatePrediccionPDF(data: PrediccionReportData): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(18);
  doc.text("Reporte de Prediccion de Demanda", pageWidth / 2, 20, { align: "center" });

  doc.setFontSize(12);
  doc.text(`Producto: ${data.producto_nombre}`, 14, 35);
  doc.text(`SKU: ${data.sku}`, 14, 42);
  doc.text(`Tendencia: ${data.tendencia}`, 14, 49);
  doc.text(`Confianza: ${Math.round(data.confianza * 100)}%`, 14, 56);

  if (data.estacionalidad.length > 0) {
    doc.text(`Dias pico: ${data.estacionalidad.join(", ")}`, 14, 63);
  }

  const totalPrediccion = data.prediccion.reduce((a, b) => a + b, 0);
  doc.text(`Total predicho (30 dias): ${totalPrediccion} unidades`, 14, 70);

  doc.setFontSize(14);
  doc.text("Proyeccion diaria", 14, 85);

  doc.setFontSize(10);
  const startY = 95;
  const daysPerPage = 14;
  let y = startY;

  for (let i = 0; i < Math.min(data.prediccion.length, daysPerPage); i++) {
    doc.text(`Dia ${i + 1}: ${Math.round(data.prediccion[i])} uds.`, 14, y);
    y += 7;
  }

  if (data.prediccion.length > daysPerPage) {
    doc.addPage();
    y = 20;
    for (let i = daysPerPage; i < data.prediccion.length; i++) {
      doc.text(`Dia ${i + 1}: ${Math.round(data.prediccion[i])} uds.`, 14, y);
      y += 7;
    }
  }

  doc.setFontSize(8);
  doc.text(
    `Generado el: ${new Date().toLocaleDateString("es-ES")}`,
    pageWidth / 2,
    doc.internal.pageSize.getHeight() - 10,
    { align: "center" }
  );

  return doc;
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

export function generateReorderPDF(sugerencias: ReorderReportData[]): jsPDF {
  const doc = new jsPDF("l");
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(18);
  doc.text("Reporte de Sugerencias de Reorden", pageWidth / 2, 15, { align: "center" });

  doc.setFontSize(9);
  const headers = ["Producto", "SKU", "Stock", "Min", "Demanda", "Sugerido", "Urgencia", "Proveedor", "Dias Entrega", "Razon"];
  const colWidths = [35, 20, 15, 15, 20, 20, 18, 30, 25, 60];
  let y = 25;

  doc.setFillColor(230, 230, 230);
  doc.rect(10, y - 5, pageWidth - 20, 8, "F");
  let x = 14;
  headers.forEach((h, i) => {
    doc.text(h, x, y);
    x += colWidths[i];
  });

  y += 8;
  sugerencias.forEach((s) => {
    if (y > doc.internal.pageSize.getHeight() - 15) {
      doc.addPage();
      y = 20;
      doc.setFillColor(230, 230, 230);
      doc.rect(10, y - 5, pageWidth - 20, 8, "F");
      x = 14;
      headers.forEach((h, i) => {
        doc.text(h, x, y);
        x += colWidths[i];
      });
      y += 8;
    }

    const row = [
      s.producto_nombre.substring(0, 20),
      s.sku,
      String(s.stock_actual),
      String(s.stock_minimo),
      s.demanda_promedio.toFixed(1),
      String(s.cantidad_sugerida),
      s.urgencia,
      s.proveedor_nombre.substring(0, 15),
      String(s.tiempo_entrega),
      s.razon.substring(0, 40),
    ];

    x = 14;
    row.forEach((cell, i) => {
      doc.text(cell, x, y);
      x += colWidths[i];
    });
    y += 6;
  });

  return doc;
}