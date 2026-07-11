export type EstadoResultadoHTMLData = {
  periodo: string;
  fecha_elaboracion: string;
  empresa: { nombre: string; rut: string };
  ingresos: {
    venta_productos: number;
    devoluciones: number;
    total_ingresos_operacionales: number;
  };
  gastos: {
    costo_venta: number;
    total_gastos: number;
  };
  utilidad_bruta: number;
  utilidad_neta: number;
};

function clp(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

export function generarHtmlEstadoResultado(data: EstadoResultadoHTMLData): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Estado de Resultado \u2014 ${data.periodo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 10pt; color: #111; background: #fff; }

    .header { text-align: center; padding: 16px 0 12px; border-bottom: 2px solid #000; margin-bottom: 16px; }
    .header h1 { font-size: 14pt; font-weight: bold; text-transform: uppercase; }
    .header h2 { font-size: 11pt; margin-top: 4px; }
    .header p  { font-size: 9pt; color: #555; margin-top: 2px; }

    .meta { display: flex; justify-content: space-between; font-size: 9pt; margin-bottom: 20px; padding: 0 4px; }

    table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-bottom: 16px; }
    th { padding: 6px 12px; text-align: left; font-weight: bold; border-bottom: 2px solid #000; }
    td { padding: 5px 12px; border-bottom: 1px solid #ddd; }
    .monto { text-align: right; font-family: monospace; white-space: nowrap; width: 25%; }

    .section-title { font-weight: bold; font-size: 10pt; padding: 8px 12px; background: #f0f0f0; border-bottom: 2px solid #000; }
    .sub-row td { padding-left: 24px; }
    .sub-row .monto { padding-left: 12px; }

    .total-row td { font-weight: bold; border-top: 2px solid #000; }
    .net-row td { font-weight: bold; font-size: 11pt; border-top: 2px solid #000; padding: 8px 12px; }
    .pos { color: #166534; }
    .neg { color: #991b1b; }

    .footer { margin-top: 20px; font-size: 8pt; color: #888; text-align: center; }

    @media print {
      body { font-size: 9pt; }
      .no-print { display: none; }
      @page { size: A4; margin: 12mm 10mm; }
    }

    .btn-print {
      display: block; margin: 0 auto 16px; padding: 8px 24px;
      background: #166534; color: #fff; border: none; border-radius: 6px;
      font-size: 11pt; cursor: pointer;
    }
  </style>
</head>
<body>
  <button class="btn-print no-print" onclick="window.print()">Imprimir / Guardar PDF</button>

  <div class="header">
    <h1>Estado de Resultado</h1>
    <h2>${data.empresa.nombre}</h2>
    <p>RUT: ${data.empresa.rut || "\u2014"}</p>
  </div>

  <div class="meta">
    <span><strong>Per\u00edodo:</strong> ${data.periodo}</span>
    <span><strong>Elaborado:</strong> ${data.fecha_elaboracion}</span>
  </div>

  <table>
    <tr><td class="section-title" colspan="2">INGRESOS OPERACIONALES</td></tr>
    <tr class="sub-row">
      <td>Venta de Productos</td>
      <td class="monto">${clp(data.ingresos.venta_productos)}</td>
    </tr>
    ${data.ingresos.devoluciones !== 0 ? `
    <tr class="sub-row">
      <td>(-) Devoluciones en Ventas</td>
      <td class="monto">${clp(data.ingresos.devoluciones)}</td>
    </tr>` : ""}
    <tr class="total-row">
      <td>Total Ingresos Operacionales</td>
      <td class="monto">${clp(data.ingresos.total_ingresos_operacionales)}</td>
    </tr>

    <tr><td class="section-title" colspan="2">GASTOS</td></tr>
    <tr class="sub-row">
      <td>Costo de Bienes Vendidos (COGS)</td>
      <td class="monto">${clp(data.gastos.costo_venta)}</td>
    </tr>
    <tr class="total-row">
      <td>Total Gastos</td>
      <td class="monto">${clp(data.gastos.total_gastos)}</td>
    </tr>

    <tr class="net-row">
      <td>UTILIDAD ${data.utilidad_neta >= 0 ? "NETA" : "P\u00c9RDIDA"}</td>
      <td class="monto ${data.utilidad_neta >= 0 ? "pos" : "neg"}">${clp(Math.abs(data.utilidad_neta))}</td>
    </tr>
  </table>

  <div class="footer">
    Generado el ${data.fecha_elaboracion}
  </div>
</body>
</html>`;
}
