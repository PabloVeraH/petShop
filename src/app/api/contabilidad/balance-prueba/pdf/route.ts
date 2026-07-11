import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generarHtmlBalancePrueba } from "@/lib/contabilidad/html-balance-prueba";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const fecha = req.nextUrl.searchParams.get("fecha") ?? new Date().toISOString().split("T")[0];
  const desde = req.nextUrl.searchParams.get("desde") ?? "1970-01-01";

  const [{ data: store }, { data: entries, error }] = await Promise.all([
    supabase.from("stores").select("name, rut").eq("id", store_id).single(),
    supabase
      .from("journal_entries")
      .select("id, fecha, total_debito, total_credito")
      .eq("store_id", store_id)
      .lte("fecha", fecha)
      .gte("fecha", desde),
  ]);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const entryIds = (entries ?? []).map((e) => e.id);

  let cuentas: Array<{ codigo: string; nombre: string; tipo: string; debitos: number; creditos: number; saldo: number }> = [];

  if (entryIds.length > 0) {
    const { data: detalles } = await supabase
      .from("journal_detail")
      .select("cuenta_codigo, cuenta_nombre, cuenta_tipo, debito, credito")
      .in("journal_entry_id", entryIds);

    const cuentaMap: Record<string, { codigo: string; nombre: string; tipo: string; debitos: number; creditos: number }> = {};
    for (const d of detalles ?? []) {
      if (!cuentaMap[d.cuenta_codigo]) {
        cuentaMap[d.cuenta_codigo] = { codigo: d.cuenta_codigo, nombre: d.cuenta_nombre, tipo: d.cuenta_tipo ?? "", debitos: 0, creditos: 0 };
      }
      cuentaMap[d.cuenta_codigo].debitos += Number(d.debito ?? 0);
      cuentaMap[d.cuenta_codigo].creditos += Number(d.credito ?? 0);
    }

    cuentas = Object.values(cuentaMap)
      .map((c) => ({
        ...c,
        debitos: Math.round(c.debitos * 100) / 100,
        creditos: Math.round(c.creditos * 100) / 100,
        saldo: Math.round((c.debitos - c.creditos) * 100) / 100,
      }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  const totalDebitos = cuentas.reduce((s, c) => s + c.debitos, 0);
  const totalCreditos = cuentas.reduce((s, c) => s + c.creditos, 0);

  const html = generarHtmlBalancePrueba({
    periodo: `Hasta ${fecha}`,
    fecha,
    fecha_elaboracion: new Date().toISOString().split("T")[0],
    empresa: { nombre: store?.name ?? "", rut: store?.rut ?? "" },
    cuentas,
    resumen: {
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
}
