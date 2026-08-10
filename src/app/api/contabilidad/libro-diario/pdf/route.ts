import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generarHtmlLibroDiario } from "@/lib/contabilidad/html-libro-diario";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const mes = req.nextUrl.searchParams.get("mes");
  const año = req.nextUrl.searchParams.get("año") ?? new Date().getFullYear().toString();
  const fecha_unica = req.nextUrl.searchParams.get("fecha");

  let desde: string;
  let hasta: string;
  let periodo: string;

  if (fecha_unica) {
    desde = hasta = fecha_unica;
    periodo = new Date(fecha_unica + "T12:00:00").toLocaleDateString("es-CL", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  } else if (mes) {
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
      .select("id, numero_asiento, fecha, tipo_movimiento, referencia_numero, descripcion, total_debito, total_credito, esta_balanceado")
      .eq("store_id", store_id)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("numero_asiento", { ascending: true }),
  ]);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const entryIds = (entries ?? []).map((e) => e.id);
  const detalleMap: Record<string, unknown[]> = {};

  if (entryIds.length > 0) {
    const { data: detalles } = await supabase
      .from("journal_detail")
      .select("journal_entry_id, numero_linea, cuenta_codigo, cuenta_nombre, debito, credito, descripcion_linea")
      .in("journal_entry_id", entryIds)
      .order("numero_linea");

    for (const d of detalles ?? []) {
      if (!detalleMap[d.journal_entry_id]) detalleMap[d.journal_entry_id] = [];
      detalleMap[d.journal_entry_id].push(d);
    }
  }

  const asientos = (entries ?? []).map((e) => ({
    ...e,
    detalles: (detalleMap[e.id] ?? []) as Array<{
      cuenta_codigo: string;
      cuenta_nombre: string;
      debito: number;
      credito: number;
      descripcion_linea?: string;
    }>,
  }));

  const totalDebitos = asientos.reduce((s, e) => s + Number(e.total_debito), 0);
  const totalCreditos = asientos.reduce((s, e) => s + Number(e.total_credito), 0);

  const html = generarHtmlLibroDiario({
    periodo,
    desde,
    hasta,
    fecha_elaboracion: new Date().toISOString().split("T")[0],
    empresa: { nombre: store?.name ?? "", rut: store?.rut ?? "" },
    asientos,
    resumen: {
      total_asientos: asientos.length,
      total_debitos: Math.round(totalDebitos * 100) / 100,
      total_creditos: Math.round(totalCreditos * 100) / 100,
      balanceado: Math.abs(totalDebitos - totalCreditos) < 0.01,
    },
  });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}, { endpoint: "GET /api/contabilidad/libro-diario/pdf" });
