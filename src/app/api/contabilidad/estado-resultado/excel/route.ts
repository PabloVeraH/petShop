import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generarExcelEstadoResultado } from "@/lib/contabilidad/excel-generator";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

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

  const periodoLabel = mes
    ? new Date(Number(año), Number(mes) - 1, 1).toLocaleString("es-CL", { month: "long", year: "numeric" })
    : año;

  const [{ data: store }] = await Promise.all([
    supabase.from("stores").select("name, rut").eq("id", store_id).single(),
  ]);

  // Reuse the existing endpoint logic inline — fetch data for Excel
  const COGS_CODIGOS = ["5.1.01"];
  const INGRESOS_CODIGOS = ["4.1.01"];
  const DEVOLUCIONES_CODIGOS = ["4.1.02"];

  // COGS from actual sales
  const { data: ventas } = await supabase
    .from("ventas")
    .select("id")
    .eq("store_id", store_id)
    .neq("estado", "anulada")
    .gte("created_at", desde)
    .lte("created_at", hasta);

  const ventaIds = (ventas ?? []).map((v) => v.id);
  let costoVenta = 0;

  if (ventaIds.length > 0) {
    const { data: items } = await supabase
      .from("venta_items")
      .select("id")
      .in("venta_id", ventaIds);

    const itemIds = (items ?? []).map((i) => i.id);
    if (itemIds.length > 0) {
      const { data: lotes } = await supabase
        .from("venta_item_lotes")
        .select("cantidad, costo_unitario")
        .in("venta_item_id", itemIds);

      costoVenta = (lotes ?? []).reduce((s, l) => s + Number(l.cantidad) * Number(l.costo_unitario), 0);
    }
  }

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

    if (costoVenta === 0) {
      costoVenta = sumCuenta(COGS_CODIGOS, "debito");
    }
  }

  const totalIngresosOp = ventaProductos - devoluciones;
  const utilidadNeta = totalIngresosOp - costoVenta;

  const buffer = generarExcelEstadoResultado({
    periodo: periodoLabel,
    empresa: { nombre: store?.name ?? "", rut: store?.rut ?? "" },
    ingresos: {
      venta_productos: Math.round(ventaProductos * 100) / 100,
      devoluciones: Math.round(-devoluciones * 100) / 100,
      total_ingresos_operacionales: Math.round(totalIngresosOp * 100) / 100,
    },
    gastos: {
      costo_venta: Math.round(costoVenta * 100) / 100,
      total_gastos: Math.round(costoVenta * 100) / 100,
    },
    utilidad_bruta: Math.round(utilidadNeta * 100) / 100,
    utilidad_neta: Math.round(utilidadNeta * 100) / 100,
  });

  const filename = `estado-resultado-${periodoLabel.replace(/\s/g, "-")}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
