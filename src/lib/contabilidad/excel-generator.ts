import * as XLSX from "xlsx";

export type CuentaBalance = {
  codigo: string;
  nombre: string;
  tipo: string;
  debitos: number;
  creditos: number;
  saldo: number;
};

export type EstadoResultadoData = {
  periodo: string;
  empresa?: { nombre: string; rut: string };
  ingresos: {
    venta_productos: number;
    devoluciones: number;
    total_ingresos_operacionales: number;
    otros_ingresos?: number;
  };
  gastos: {
    costo_venta: number;
    gastos_operacionales?: number;
    gastos_financieros?: number;
    total_gastos: number;
  };
  utilidad_bruta?: number;
  utilidad_operacional?: number;
  utilidad_neta: number;
};

function clp(n: number): string {
  return Math.round(n).toLocaleString("es-CL");
}

export function generarExcelBalance(
  cuentas: CuentaBalance[],
  meta: { periodo: string; fecha: string; empresa: string; rut: string }
): Buffer {
  const wb = XLSX.utils.book_new();

  const titulo = [
    ["BALANCE DE COMPROBACIÓN"],
    [meta.empresa],
    [`RUT: ${meta.rut || "—"}`],
    [`Período: ${meta.periodo}     Fecha: ${meta.fecha}`],
    [],
    ["Código", "Cuenta", "Tipo", "Débitos ($)", "Créditos ($)", "Saldo ($)"],
  ];

  const filas = cuentas.map((c) => [
    c.codigo,
    c.nombre,
    c.tipo,
    Math.round(c.debitos),
    Math.round(c.creditos),
    Math.round(c.saldo),
  ]);

  const totalDebitos = cuentas.reduce((s, c) => s + c.debitos, 0);
  const totalCreditos = cuentas.reduce((s, c) => s + c.creditos, 0);
  const balanceado = Math.abs(totalDebitos - totalCreditos) < 0.01;

  const totales = [
    [],
    ["", "TOTALES:", "", Math.round(totalDebitos), Math.round(totalCreditos), Math.round(totalDebitos - totalCreditos)],
    ["", balanceado ? "✓ Libro balanceado (Dr = Cr)" : "✗ ATENCIÓN: Libro descuadrado"],
  ];

  const wsData = [...titulo, ...filas, ...totales];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  ws["!cols"] = [
    { wch: 10 },
    { wch: 32 },
    { wch: 12 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
  ];

  // Negrita en encabezado y totales
  ["A1", "A6", "B6", "C6", "D6", "E6", "F6"].forEach((cell) => {
    if (ws[cell]) ws[cell].s = { font: { bold: true } };
  });

  XLSX.utils.book_append_sheet(wb, ws, "Balance");

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

export function generarExcelEstadoResultado(
  data: EstadoResultadoData
): Buffer {
  const wb = XLSX.utils.book_new();

  const rows: (string | number)[][] = [
    ["ESTADO DE RESULTADO"],
    [data.empresa?.nombre ?? ""],
    [`RUT: ${data.empresa?.rut ?? "—"}`],
    [`Período: ${data.periodo}`],
    [],
    ["INGRESOS OPERACIONALES", ""],
    ["Venta de Productos", Math.round(data.ingresos.venta_productos)],
  ];

  if (data.ingresos.devoluciones !== 0) {
    rows.push(["(-) Devoluciones en Ventas", Math.round(data.ingresos.devoluciones)]);
  }
  if (data.ingresos.otros_ingresos) {
    rows.push(["Otros Ingresos", Math.round(data.ingresos.otros_ingresos)]);
  }

  rows.push(
    ["Total Ingresos Operacionales", Math.round(data.ingresos.total_ingresos_operacionales)],
    [],
    ["GASTOS", ""],
    ["Costo de Bienes Vendidos (COGS)", Math.round(data.gastos.costo_venta)]
  );

  if (data.gastos.gastos_operacionales) {
    rows.push(["Gastos Operacionales", Math.round(data.gastos.gastos_operacionales)]);
  }
  if (data.gastos.gastos_financieros) {
    rows.push(["Gastos Financieros", Math.round(data.gastos.gastos_financieros)]);
  }

  rows.push(
    ["Total Gastos", Math.round(data.gastos.total_gastos)],
    [],
    ["UTILIDAD NETA", Math.round(data.utilidad_neta)]
  );

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 36 }, { wch: 18 }];

  XLSX.utils.book_append_sheet(wb, ws, "Estado de Resultado");

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

export function generarExcelLibroDiario(
  asientos: Array<{
    numero_asiento: number;
    fecha: string;
    tipo_movimiento?: string;
    descripcion: string;
    referencia_numero?: string;
    total_debito: number;
    total_credito: number;
    esta_balanceado: boolean;
  }>,
  meta: { periodo: string; empresa: string; rut: string }
): Buffer {
  const wb = XLSX.utils.book_new();

  const titulo = [
    ["LIBRO DIARIO"],
    [meta.empresa],
    [`RUT: ${meta.rut || "—"}`],
    [`Período: ${meta.periodo}`],
    [],
    ["Nro.", "Fecha", "Tipo", "Descripción", "Referencia", "Débito ($)", "Crédito ($)", "Balanceado"],
  ];

  const filas = asientos.map((a) => [
    a.numero_asiento,
    a.fecha,
    a.tipo_movimiento ?? "",
    a.descripcion,
    a.referencia_numero ?? "",
    Math.round(Number(a.total_debito)),
    Math.round(Number(a.total_credito)),
    a.esta_balanceado ? "✓" : "✗",
  ]);

  const totalD = asientos.reduce((s, a) => s + Number(a.total_debito), 0);
  const totalC = asientos.reduce((s, a) => s + Number(a.total_credito), 0);

  const wsData = [
    ...titulo,
    ...filas,
    [],
    ["", "", "", "TOTALES:", "", Math.round(totalD), Math.round(totalC)],
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = [
    { wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 40 },
    { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Libro Diario");

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
