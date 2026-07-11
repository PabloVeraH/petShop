export type CuentaBalanceHTML = {
  codigo: string;
  nombre: string;
  tipo: string;
  debitos: number;
  creditos: number;
  saldo: number;
};

export type BalancePruebaHTMLData = {
  periodo: string;
  fecha: string;
  fecha_elaboracion: string;
  empresa: { nombre: string; rut: string };
  cuentas: CuentaBalanceHTML[];
  resumen: {
    total_debitos: number;
    total_creditos: number;
    balanceado: boolean;
  };
};

function clp(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

export function generarHtmlBalancePrueba(data: BalancePruebaHTMLData): string {
  const filas = data.cuentas
    .map(
      (c) => `
        <tr>
          <td class="codigo">${c.codigo}</td>
          <td>${c.nombre}</td>
          <td class="tipo">${c.tipo}</td>
          <td class="monto">${c.debitos > 0 ? clp(c.debitos) : ""}</td>
          <td class="monto">${c.creditos > 0 ? clp(c.creditos) : ""}</td>
          <td class="monto">${clp(c.saldo)}</td>
        </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Balance de Comprobaci\u00f3n \u2014 ${data.periodo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 10pt; color: #111; background: #fff; }

    .header { text-align: center; padding: 16px 0 12px; border-bottom: 2px solid #000; margin-bottom: 16px; }
    .header h1 { font-size: 14pt; font-weight: bold; text-transform: uppercase; }
    .header h2 { font-size: 11pt; margin-top: 4px; }
    .header p  { font-size: 9pt; color: #555; margin-top: 2px; }

    .meta { display: flex; justify-content: space-between; font-size: 9pt; margin-bottom: 14px; padding: 0 4px; }

    table { width: 100%; border-collapse: collapse; font-size: 9pt; }
    thead th { background: #222; color: #fff; padding: 6px 8px; text-align: left; font-weight: bold; }
    thead th.monto, tfoot td.monto { text-align: right; }

    td { padding: 5px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
    tr:nth-child(even) { background: #f9f9f9; }

    .codigo { font-family: monospace; font-size: 8.5pt; width: 10%; }
    .tipo   { font-size: 8pt; color: #555; width: 10%; }
    .monto  { text-align: right; font-family: monospace; white-space: nowrap; width: 14%; }

    tfoot { border-top: 2px solid #000; }
    tfoot td { padding: 7px 8px; font-weight: bold; }
    .balance-ok  { color: #166534; }
    .balance-err { color: #991b1b; }

    .footer { margin-top: 20px; font-size: 8pt; color: #888; text-align: center; }

    @media print {
      body { font-size: 9pt; }
      .no-print { display: none; }
      @page { size: A4 landscape; margin: 12mm 10mm; }
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
    <h1>Balance de Comprobaci\u00f3n</h1>
    <h2>${data.empresa.nombre}</h2>
    <p>RUT: ${data.empresa.rut || "\u2014"}</p>
  </div>

  <div class="meta">
    <span><strong>Per\u00edodo:</strong> ${data.periodo}</span>
    <span><strong>Fecha:</strong> ${data.fecha}</span>
    <span><strong>Elaborado:</strong> ${data.fecha_elaboracion}</span>
  </div>

  <table>
    <thead>
      <tr>
        <th>C\u00f3digo</th>
        <th>Cuenta</th>
        <th>Tipo</th>
        <th class="monto">D\u00e9bitos</th>
        <th class="monto">Cr\u00e9ditos</th>
        <th class="monto">Saldo</th>
      </tr>
    </thead>
    <tbody>
      ${filas || '<tr><td colspan="6" style="text-align:center;padding:32px;color:#888">Sin movimientos en este per\u00edodo</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="text-align:right">TOTALES:</td>
        <td class="monto">${clp(data.resumen.total_debitos)}</td>
        <td class="monto">${clp(data.resumen.total_creditos)}</td>
        <td class="monto">${clp(data.resumen.total_debitos - data.resumen.total_creditos)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="footer">
    ${data.resumen.balanceado ? "\u2713 Libro balanceado (Dr = Cr)" : "\u2717 ATENCI\u00d3N: Libro descuadrado"}
    &nbsp;|&nbsp; Generado el ${data.fecha_elaboracion}
  </div>
</body>
</html>`;
}
