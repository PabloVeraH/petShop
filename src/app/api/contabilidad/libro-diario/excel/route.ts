import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generarExcelLibroDiario } from "@/lib/contabilidad/excel-generator";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const mes = req.nextUrl.searchParams.get("mes");
  const año = req.nextUrl.searchParams.get("año") ?? new Date().getFullYear().toString();

  let desde: string;
  let hasta: string;
  let periodo: string;

  if (mes) {
    const m = mes.padStart(2, "0");
    const lastDay = new Date(Number(año), Number(mes), 0).getDate();
    desde = `${año}-${m}-01`;
    hasta = `${año}-${m}-${lastDay}`;
    periodo = new Date(Number(año), Number(mes) - 1, 1).toLocaleString("es-CL", {
      month: "long", year: "numeric",
    });
  } else {
    desde = `${año}-01-01`;
    hasta = `${año}-12-31`;
    periodo = año;
  }

  const [{ data: store }, { data: entries, error }] = await Promise.all([
    supabase.from("stores").select("name, rut").eq("id", store_id).single(),
    supabase
      .from("journal_entries")
      .select("numero_asiento, fecha, tipo_movimiento, descripcion, referencia_numero, total_debito, total_credito, esta_balanceado")
      .eq("store_id", store_id)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("numero_asiento", { ascending: true }),
  ]);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const buffer = generarExcelLibroDiario(entries ?? [], {
    periodo,
    empresa: store?.name ?? "",
    rut: store?.rut ?? "",
  });

  const filename = `libro-diario-${periodo.replace(/\s/g, "-")}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
