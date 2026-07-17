import jsPDF from "jspdf";

export interface BoletaData {
  numeroComprobante: string;
  fecha: string;
  storeName: string;
  storeRut?: string;
  cliente?: { nombre: string; rut?: string };
  items: Array<{ nombre: string; cantidad: number; precio_unitario: number; subtotal: number }>;
  subtotal: number;
  descuentoPct: number;
  descuentoMonto: number;
  impuesto: number;
  total: number;
  pagos: Array<{ metodo: string; monto: number; numero_transaccion?: string }>;
}

const METODO_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  nota_credito: "Nota de Crédito",
  mixto: "Mixto",
};

export function generateBoletaPDF(data: BoletaData): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 25;
  const contentWidth = pageWidth - margin * 2;
  let y = 20;

  const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
  // Subtotal (sin IVA) del monto efectivamente cobrado — NO netoDesdeBruto(data.subtotal),
  // que es el bruto pre-descuento y rompe la invariante Subtotal + IVA = Total en la boleta
  // cuando hay descuento (ver AGENTS.md §23.3).
  const subtotalNeto = data.total - data.impuesto;
  const fecha = new Date(data.fecha);
  const fechaStr = fecha.toLocaleDateString("es-CL");
  const horaStr = fecha.toLocaleTimeString("es-CL");

  // Header
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(data.storeName, pageWidth / 2, y, { align: "center" });
  y += 8;

  if (data.storeRut) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`RUT: ${data.storeRut}`, pageWidth / 2, y, { align: "center" });
    y += 6;
  }

  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 7;

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("BOLETA", pageWidth / 2, y, { align: "center" });
  y += 7;

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(data.numeroComprobante, pageWidth / 2, y, { align: "center" });
  y += 6;
  doc.setFontSize(10);
  doc.text(`${fechaStr} ${horaStr}`, pageWidth / 2, y, { align: "center" });
  y += 9;

  // Cliente
  if (data.cliente) {
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("CLIENTE", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.text(data.cliente.nombre, margin, y);
    y += 5;
    if (data.cliente.rut) {
      doc.text(`RUT: ${data.cliente.rut}`, margin, y);
      y += 5;
    }
    y += 2;
  }

  // Products table header
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Producto", margin, y);
  doc.text("Cant", margin + contentWidth * 0.58, y, { align: "right" });
  doc.text("Precio", margin + contentWidth * 0.79, y, { align: "right" });
  doc.text("Total", margin + contentWidth, y, { align: "right" });
  y += 3;
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  for (const item of data.items) {
    const nombre = item.nombre.length > 38 ? item.nombre.slice(0, 36) + "…" : item.nombre;
    doc.text(nombre, margin, y);
    doc.text(String(item.cantidad), margin + contentWidth * 0.58, y, { align: "right" });
    doc.text(fmt(item.precio_unitario), margin + contentWidth * 0.79, y, { align: "right" });
    doc.text(fmt(item.subtotal), margin + contentWidth, y, { align: "right" });
    y += 6;
  }

  // Totals
  y += 2;
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  const totRow = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(label, margin + contentWidth * 0.45, y);
    doc.text(value, margin + contentWidth, y, { align: "right" });
    y += 5;
  };

  doc.setFontSize(10);
  totRow("Subtotal:", fmt(subtotalNeto));
  if (data.descuentoMonto > 0) {
    totRow(`Descuento (${data.descuentoPct}%):`, `-${fmt(data.descuentoMonto)}`);
  }
  totRow("IVA (19%):", fmt(data.impuesto));

  y += 1;
  doc.setLineWidth(0.5);
  doc.line(margin + contentWidth * 0.45, y, pageWidth - margin, y);
  y += 5;
  doc.setFontSize(12);
  totRow("TOTAL:", fmt(data.total), true);

  // Pagos
  y += 3;
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("FORMAS DE PAGO", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");

  for (const pago of data.pagos) {
    let label = METODO_LABELS[pago.metodo] ?? pago.metodo;
    if (pago.numero_transaccion) label += ` #${pago.numero_transaccion}`;
    doc.text(label, margin, y);
    doc.text(fmt(pago.monto), margin + contentWidth, y, { align: "right" });
    y += 5;
  }

  // Footer
  y += 5;
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Este documento NO constituye un documento tributario.", pageWidth / 2, y, { align: "center" });
  y += 4;
  doc.text("Gracias por su compra.", pageWidth / 2, y, { align: "center" });

  return doc;
}

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