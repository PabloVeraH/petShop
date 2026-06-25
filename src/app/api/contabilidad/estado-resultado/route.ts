import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { CUENTAS } from "@/lib/contabilidad/types";

const INGRESOS_CODIGOS = [CUENTAS.VENTAS.codigo];
const DEVOLUCIONES_CODIGOS = [CUENTAS.DEVOLUCIONES.codigo];
const COGS_CODIGOS = [CUENTAS.COGS.codigo];

async function calcularCostoVentaActual(supabase: ReturnType<typeof createServiceClient>, store_id: string, desde: string, hasta: string): Promise<number> {
  const { data: ventas } = await supabase
    .from("ventas")
    .select("id")
    .eq("store_id", store_id)
    .neq("estado", "anulada")
    .gte("created_at", desde)
    .lte("created_at", hasta);

  const ventaIds = (ventas ?? []).map((v) => v.id);
  if (ventaIds.length === 0) return 0;

  const { data: items } = await supabase
    .from("venta_items")
    .select("id")
    .in("venta_id", ventaIds);

  const itemIds = (items ?? []).map((i) => i.id);
  if (itemIds.length === 0) return 0;

  const { data: lotes } = await supabase
    .from("venta_item_lotes")
    .select("cantidad, costo_unitario")
    .in("venta_item_id", itemIds);

  return (lotes ?? []).reduce((s, l) => s + Number(l.cantidad) * Number(l.costo_unitario), 0);
}

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

  // COGS from actual sales data (venta_item_lotes) — ground truth
  let costoVenta = await calcularCostoVentaActual(supabase, store_id, desde, hasta);

  const { data: entries } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("store_id", store_id)
    .gte("fecha", desde)
    .lte("fecha", hasta);

  const entryIds = (entries ?? []).map((e) => e.id);

  let ventaProductos = 0;
  let devoluciones = 0;

  if (entryIds.length > 0) {
    const { data: detalles } = await supabase
      .from("journal_detail")
      .select("cuenta_codigo, debito, credito")
      .in("journal_entry_id", entryIds);

    const sumCuenta = (codigos: string[], campo: "debito" | "credito") =>
      (detalles ?? [])
        .filter((d) => codigos.includes(d.cuenta_codigo))
        .reduce((s, d) => s + Number(d[campo] ?? 0), 0);

    ventaProductos = sumCuenta(INGRESOS_CODIGOS, "credito");
    devoluciones = sumCuenta(DEVOLUCIONES_CODIGOS, "debito");

    // Fallback: si no hay ventas reales, usar COGS desde asientos contables
    if (costoVenta === 0) {
      costoVenta = sumCuenta(COGS_CODIGOS, "debito");
    }
  }

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
