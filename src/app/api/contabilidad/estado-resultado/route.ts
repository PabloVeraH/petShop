import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { CUENTAS } from "@/lib/contabilidad/types";

const INGRESOS_CODIGOS = [CUENTAS.VENTAS.codigo];
const DEVOLUCIONES_CODIGOS = [CUENTAS.DEVOLUCIONES.codigo];
const COGS_CODIGOS = [CUENTAS.COGS.codigo];

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { data: store } = await supabase
    .from("stores")
    .select("name")
    .eq("id", store_id)
    .single();

  const nombreEmpresa = store?.name ?? "";

  const mes = req.nextUrl.searchParams.get("mes");
  const año = req.nextUrl.searchParams.get("año") ?? new Date().getFullYear().toString();

  let desde: string;
  let hasta: string;

  if (mes) {
    const m = mes.padStart(2, "0");
    const lastDay = new Date(Number(año), Number(mes), 0).getDate();
    desde = `${año}-${m}-01`;
    hasta = `${año}-${m}-${lastDay}`;
  } else {
    desde = `${año}-01-01`;
    hasta = `${año}-12-31`;
  }

  const periodo = mes
    ? new Date(Number(año), Number(mes) - 1, 1).toLocaleString("es-CL", { month: "long", year: "numeric" })
    : año;

  const { data: entries } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("store_id", store_id)
    .gte("fecha", desde)
    .lte("fecha", hasta);

  const entryIds = (entries ?? []).map((e) => e.id);

  if (entryIds.length === 0) {
    return NextResponse.json({
      empresa: { nombre: nombreEmpresa },
      periodo,
      desde,
      hasta,
      ingresos: { venta_productos: 0, devoluciones: 0, total_ingresos_operacionales: 0 },
      gastos: { costo_venta: 0, total_gastos: 0 },
      utilidad_bruta: 0,
      utilidad_neta: 0,
    });
  }

  const { data: detalles } = await supabase
    .from("journal_detail")
    .select("cuenta_codigo, debito, credito")
    .in("journal_entry_id", entryIds);

  const sumCuenta = (codigos: string[], campo: "debito" | "credito") =>
    (detalles ?? [])
      .filter((d) => codigos.includes(d.cuenta_codigo))
      .reduce((s, d) => s + Number(d[campo] ?? 0), 0);

  const ventaProductos = sumCuenta(INGRESOS_CODIGOS, "credito");
  const devoluciones = sumCuenta(DEVOLUCIONES_CODIGOS, "debito");
  const costoVenta = sumCuenta(COGS_CODIGOS, "debito");

  const totalIngresosOp = ventaProductos - devoluciones;
  const utilidadBruta = totalIngresosOp - costoVenta;
  const utilidadNeta = utilidadBruta;

  return NextResponse.json({
    empresa: { nombre: nombreEmpresa },
    periodo,
    desde,
    hasta,
    ingresos: {
      venta_productos: Math.round(ventaProductos * 100) / 100,
      devoluciones: Math.round(-devoluciones * 100) / 100,
      total_ingresos_operacionales: Math.round(totalIngresosOp * 100) / 100,
    },
    gastos: {
      costo_venta: Math.round(costoVenta * 100) / 100,
      total_gastos: Math.round(costoVenta * 100) / 100,
    },
    utilidad_bruta: Math.round(utilidadBruta * 100) / 100,
    utilidad_neta: Math.round(utilidadNeta * 100) / 100,
  });
}
