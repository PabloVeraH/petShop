import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generarHtmlEstadoResultado } from "@/lib/contabilidad/html-estado-resultado";
import { calcularDatosEstadoResultado } from "@/lib/contabilidad/estado-resultado";

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

  const [{ data: store }] = await Promise.all([
    supabase.from("stores").select("name, rut").eq("id", store_id).single(),
  ]);

  const { ventaProductos, devoluciones, costoVenta } = await calcularDatosEstadoResultado(
    supabase,
    store_id,
    desde,
    hasta
  );

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
