type DetalleLinea = {
  cuenta_codigo: string;
  cuenta_nombre: string;
  debito: number;
  credito: number;
  descripcion_linea?: string;
};

type AsientoHTML = {
  numero_asiento: number;
  fecha: string;
  tipo_movimiento?: string;
  referencia_numero?: string;
  descripcion: string;
  total_debito: number;
  total_credito: number;
  esta_balanceado: boolean;
  detalles?: DetalleLinea[];
};

export type LibroDiarioHTMLData = {
  periodo: string;
  desde: string;
  hasta: string;
  fecha_elaboracion: string;
  empresa: { nombre: string; rut: string };
  asientos: AsientoHTML[];
  resumen: {
    total_asientos: number;
    total_debitos: number;
    total_creditos: number;
    balanceado: boolean;
  };
};

function clp(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function fmtFecha(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("es-CL");
}

export function generarHtmlLibroDiario(data: LibroDiarioHTMLData): string {
  const filas = data.asientos
    .map((a) => {
      const detalleRows = (a.detalles ?? [])
        .map(
          (d) => `
        <tr class="detalle-row">
          <td></td>
          <td></td>
          <td colspan="2" class="cuenta-cell">
            <span class="cuenta-codigo">${d.cuenta_codigo}</span>
            ${d.cuenta_nombre}${d.descripcion_linea ? ` — ${d.descripcion_linea}` : ""}
          </td>
          <td class="monto">${d.debito > 0 ? clp(d.debito) : ""}</td>
          <td class="monto">${d.credito > 0 ? clp(d.credito) : ""}</td>
          <td></td>
        </tr>`
        )
        .join("");

      return `
      <tr class="asiento-row">
        <td class="nro">${a.numero_asiento}</td>
        <td class="fecha">${fmtFecha(a.fecha)}</td>
        <td class="tipo">${a.tipo_movimiento?.replace("_", " ") ?? ""}</td>
        <td class="desc">
          ${a.descripcion}
          ${a.referencia_numero ? `<div class="ref">${a.referencia_numero}</div>` : ""}
        </td>
        <td class="monto">${clp(Number(a.total_debito))}</td>
        <td class="monto">${clp(Number(a.total_credito))}</td>
        <td class="bal">${a.esta_balanceado ? "✓" : "✗"}</td>
      </tr>
      ${detalleRows}`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Libro Diario — ${data.periodo}</title>
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

    .asiento-row td { padding: 5px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
    .asiento-row { background: #fff; }
    .asiento-row:nth-child(4n+1) { background: #f9f9f9; }

    .detalle-row td { padding: 2px 8px 2px 16px; font-size: 8.5pt; color: #444; border-bottom: 1px dashed #eee; }

    .nro   { width: 5%; font-family: monospace; }
    .fecha { width: 10%; white-space: nowrap; }
    .tipo  { width: 12%; font-size: 8pt; color: #555; }
    .desc  { width: 36%; }
    .monto { width: 13%; text-align: right; font-family: monospace; white-space: nowrap; }
    .bal   { width: 5%; text-align: center; }

    .ref { font-size: 7.5pt; color: #999; font-family: monospace; }
    .cuenta-codigo { font-family: monospace; font-size: 8pt; color: #888; margin-right: 4px; }
    .cuenta-cell { padding-left: 24px !important; }

    tfoot { border-top: 2px solid #000; }
    tfoot td { padding: 7px 8px; font-weight: bold; }
    .balance-ok  { color: #166534; }
    .balance-err { color: #991b1b; }

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
    <h1>Libro Diario</h1>
    <h2>${data.empresa.nombre}</h2>
    <p>RUT: ${data.empresa.rut || "—"}</p>
  </div>

  <div class="meta">
    <span><strong>Período:</strong> ${data.periodo}</span>
    <span><strong>Desde:</strong> ${fmtFecha(data.desde)} &nbsp; <strong>Hasta:</strong> ${fmtFecha(data.hasta)}</span>
    <span><strong>Elaborado:</strong> ${fmtFecha(data.fecha_elaboracion)}</span>
  </div>

  <table>
    <thead>
      <tr>
        <th class="nro">Nro.</th>
        <th class="fecha">Fecha</th>
        <th class="tipo">Tipo</th>
        <th>Descripción / Glosa</th>
        <th class="monto">Débito</th>
        <th class="monto">Crédito</th>
        <th class="bal">OK</th>
      </tr>
    </thead>
    <tbody>
      ${filas || '<tr><td colspan="7" style="text-align:center;padding:32px;color:#888">Sin asientos en este período</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="text-align:right">TOTALES DEL PERÍODO:</td>
        <td class="monto">${clp(data.resumen.total_debitos)}</td>
        <td class="monto">${clp(data.resumen.total_creditos)}</td>
        <td class="bal ${data.resumen.balanceado ? "balance-ok" : "balance-err"}">
          ${data.resumen.balanceado ? "✓" : "✗"}
        </td>
      </tr>
    </tfoot>
  </table>

  <div class="footer">
    Total asientos: ${data.resumen.total_asientos} &nbsp;|&nbsp;
    ${data.resumen.balanceado ? "✓ Libro balanceado (Dr = Cr)" : "✗ ATENCIÓN: Libro descuadrado"}
    &nbsp;|&nbsp; Generado el ${fmtFecha(data.fecha_elaboracion)}
  </div>
</body>
</html>`;
}
