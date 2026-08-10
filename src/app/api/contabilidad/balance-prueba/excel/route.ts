import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generarExcelBalance } from "@/lib/contabilidad/excel-generator";
import { getCuentaTipo } from "@/lib/contabilidad/types";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const fecha = req.nextUrl.searchParams.get("fecha") ?? new Date().toISOString().split("T")[0];
  const mes = req.nextUrl.searchParams.get("mes");
  const año = req.nextUrl.searchParams.get("año") ?? new Date().getFullYear().toString();

  let periodo: string;
  if (mes) {
    periodo = new Date(Number(año), Number(mes) - 1, 1).toLocaleString("es-CL", {
      month: "long", year: "numeric",
    });
  } else {
    periodo = new Date(fecha + "T12:00:00").toLocaleDateString("es-CL");
  }

  const [{ data: store }, { data: detalles, error }] = await Promise.all([
    supabase.from("stores").select("name, rut").eq("id", store_id).single(),
    supabase
      .from("journal_detail")
      .select("cuenta_codigo, cuenta_nombre, cuenta_tipo, debito, credito, journal_entry_id")
      .eq(
        "journal_entry_id",
        supabase
          .from("journal_entries")
          .select("id")
          .eq("store_id", store_id)
          .lte("fecha", fecha)
      ),
  ]);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const { data: entries } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("store_id", store_id)
    .lte("fecha", fecha);

  const entryIds = (entries ?? []).map((e) => e.id);

  let rows: Array<{ cuenta_codigo: string; cuenta_nombre: string; cuenta_tipo: string; debito: number; credito: number }> = [];

  if (entryIds.length > 0) {
    const { data } = await supabase
      .from("journal_detail")
      .select("cuenta_codigo, cuenta_nombre, cuenta_tipo, debito, credito")
      .in("journal_entry_id", entryIds);
    rows = data ?? [];
  }

  const cuentaMap: Record<string, { nombre: string; tipo: string; debitos: number; creditos: number }> = {};
  for (const r of rows) {
    if (!cuentaMap[r.cuenta_codigo]) {
      cuentaMap[r.cuenta_codigo] = { nombre: r.cuenta_nombre, tipo: getCuentaTipo(r.cuenta_codigo, r.cuenta_tipo ?? ""), debitos: 0, creditos: 0 };
    }
    cuentaMap[r.cuenta_codigo].debitos += Number(r.debito);
    cuentaMap[r.cuenta_codigo].creditos += Number(r.credito);
  }

  const cuentas = Object.entries(cuentaMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([codigo, c]) => ({
      codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      debitos: Math.round(c.debitos * 100) / 100,
      creditos: Math.round(c.creditos * 100) / 100,
      saldo: Math.round((c.debitos - c.creditos) * 100) / 100,
    }));

  const buffer = generarExcelBalance(cuentas, {
    periodo,
    fecha,
    empresa: store?.name ?? "",
    rut: store?.rut ?? "",
  });

  const filename = `balance-comprobacion-${periodo.replace(/\s/g, "-")}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}, { endpoint: "GET /api/contabilidad/balance-prueba/excel" });
