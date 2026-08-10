import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { calcularDatosEstadoResultado } from "@/lib/contabilidad/estado-resultado";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (req: NextRequest) => {
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

  const { ventaProductos, devoluciones, costoVenta } = await calcularDatosEstadoResultado(
    supabase,
    store_id,
    desde,
    hasta
  );

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
}, { endpoint: "GET /api/contabilidad/estado-resultado" });
