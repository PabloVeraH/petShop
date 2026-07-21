import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getCuentaTipo } from "@/lib/contabilidad/types";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const fecha = req.nextUrl.searchParams.get("fecha") ?? new Date().toISOString().split("T")[0];
  const desde = req.nextUrl.searchParams.get("desde") ?? "1970-01-01";

  // Obtener todas las líneas de asientos hasta la fecha indicada
  const { data: entries, error } = await supabase
    .from("journal_entries")
    .select("id, fecha, total_debito, total_credito")
    .eq("store_id", store_id)
    .lte("fecha", fecha)
    .gte("fecha", desde);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const entryIds = (entries ?? []).map((e) => e.id);

  if (entryIds.length === 0) {
    return NextResponse.json({
      fecha,
      periodo: `Hasta ${fecha}`,
      cuentas: [],
      total_debitos: 0,
      total_creditos: 0,
      balanceado: true,
    });
  }

  const { data: detalles, error: detErr } = await supabase
    .from("journal_detail")
    .select("cuenta_codigo, cuenta_nombre, cuenta_tipo, debito, credito")
    .in("journal_entry_id", entryIds);

  if (detErr) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  // Agrupar por cuenta
  const cuentaMap: Record<string, {
    codigo: string;
    nombre: string;
    tipo: string;
    debitos: number;
    creditos: number;
  }> = {};

  for (const d of detalles ?? []) {
    if (!cuentaMap[d.cuenta_codigo]) {
      cuentaMap[d.cuenta_codigo] = {
        codigo: d.cuenta_codigo,
        nombre: d.cuenta_nombre,
        tipo: getCuentaTipo(d.cuenta_codigo, d.cuenta_tipo ?? ""),
        debitos: 0,
        creditos: 0,
      };
    }
    cuentaMap[d.cuenta_codigo].debitos += Number(d.debito ?? 0);
    cuentaMap[d.cuenta_codigo].creditos += Number(d.credito ?? 0);
  }

  const cuentas = Object.values(cuentaMap)
    .map((c) => ({
      ...c,
      debitos: Math.round(c.debitos * 100) / 100,
      creditos: Math.round(c.creditos * 100) / 100,
      saldo: Math.round((c.debitos - c.creditos) * 100) / 100,
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));

  const totalDebitos = cuentas.reduce((s, c) => s + c.debitos, 0);
  const totalCreditos = cuentas.reduce((s, c) => s + c.creditos, 0);

  return NextResponse.json({
    fecha,
    periodo: `Hasta ${fecha}`,
    cuentas,
    total_debitos: Math.round(totalDebitos * 100) / 100,
    total_creditos: Math.round(totalCreditos * 100) / 100,
    balanceado: Math.abs(totalDebitos - totalCreditos) < 0.01,
  });
}
