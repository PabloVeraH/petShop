import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generarHtmlEstadoResultado } from "@/lib/contabilidad/html-estado-resultado";

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

  const periodo = mes
    ? new Date(Number(año), Number(mes) - 1, 1).toLocaleString("es-CL", { month: "long", year: "numeric" })
    : año;

  const [{ data: store }, { data: ventas }] = await Promise.all([
    supabase.from("stores").select("name, rut").eq("id", store_id).single(),
    supabase.from("ventas").select("id").eq("store_id", store_id).neq("estado", "anulada").gte("created_at", desde).lte("created_at", hasta),
  ]);

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
      (detalles ?? []).filter((d) => codigos.includes(d.cuenta_codigo)).reduce((s, d) => s + Number(d[campo] ?? 0), 0);

    const VENTAS_CODIGO = "410101";
    const DEVOLUCIONES_CODIGO = "410102";
    const COGS_CODIGO = "510101";

    const ventaCredits = sumCuenta([VENTAS_CODIGO], "credito");
    const ventaDebits = sumCuenta([VENTAS_CODIGO], "debito");
    ventaProductos = ventaCredits - ventaDebits;
    devoluciones = sumCuenta([DEVOLUCIONES_CODIGO], "debito");

    if (costoVenta === 0) {
      const cogsDebits = sumCuenta([COGS_CODIGO], "debito");
      const cogsCredits = sumCuenta([COGS_CODIGO], "credito");
      costoVenta = cogsDebits - cogsCredits;
    }
  }

  const totalIngresosOp = ventaProductos - devoluciones;
  const utilidadBruta = totalIngresosOp - costoVenta;
  const utilidadNeta = utilidadBruta;

  const html = generarHtmlEstadoResultado({
    periodo,
    fecha_elaboracion: new Date().toISOString().split("T")[0],
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
    utilidad_bruta: Math.round(utilidadBruta * 100) / 100,
    utilidad_neta: Math.round(utilidadNeta * 100) / 100,
  });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
