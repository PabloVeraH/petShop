import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { z } from "zod";
import { crearAsiento, lineasCierreCOGS } from "@/lib/contabilidad/generador-asientos";
import { CUENTAS } from "@/lib/contabilidad/types";
import { logAudit, getRequestMetadata } from "@/lib/audit";

const CierreMesSchema = z.object({
  mes: z.number().int().min(1).max(12),
  año: z.number().int().min(2020).max(2100),
  calcular_costo_venta: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const body = await req.json();
  const parsed = CierreMesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { mes, año, calcular_costo_venta } = parsed.data;
  const m = String(mes).padStart(2, "0");
  const lastDay = new Date(año, mes, 0).getDate();
  const desde = `${año}-${m}-01`;
  const hasta = `${año}-${m}-${lastDay}`;
  const periodo = `${año}-${m}`;

  const supabase = createServiceClient();

  // Verificar que no exista ya un asiento de cierre para este período
  const { data: cierresExistentes } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("store_id", store_id)
    .eq("tipo_movimiento", "CIERRE_MES")
    .eq("referencia_numero", periodo);

  if (cierresExistentes && cierresExistentes.length > 0) {
    console.warn(
      `[cierre-mes] Intento duplicado para ${periodo} (store=${store_id}, usuario=${ctx.userId}): ${cierresExistentes.length} asiento(s) existente(s)`
    );
    return NextResponse.json(
      { error: `El período ${periodo} ya tiene un asiento de cierre` },
      { status: 409 }
    );
  }

  const { data: entries } = await supabase
    .from("journal_entries")
    .select("id, total_debito, total_credito")
    .eq("store_id", store_id)
    .gte("fecha", desde)
    .lte("fecha", hasta);

  const totalDebitos = (entries ?? []).reduce((s, e) => s + Number(e.total_debito), 0);
  const totalCreditos = (entries ?? []).reduce((s, e) => s + Number(e.total_credito), 0);

  const asientosCierre = [];

  if (calcular_costo_venta) {
    // Estimar COGS como suma de compras del período (método simplificado)
    const { data: compras } = await supabase
      .from("journal_entries")
      .select("id")
      .eq("store_id", store_id)
      .eq("tipo_movimiento", "COMPRA")
      .gte("fecha", desde)
      .lte("fecha", hasta);

    const compraIds = (compras ?? []).map((c) => c.id);

    if (compraIds.length > 0) {
      const { data: inventarioLines } = await supabase
        .from("journal_detail")
        .select("debito")
        .in("journal_entry_id", compraIds)
        .eq("cuenta_codigo", CUENTAS.INVENTARIO.codigo);

      const costoTotal = (inventarioLines ?? []).reduce((s, l) => s + Number(l.debito), 0);

      if (costoTotal > 0) {
        const cogsId = await crearAsiento({
          storeId: store_id,
          fecha: hasta,
          tipoMovimiento: "CIERRE_MES",
          referenciaNomero: periodo,
          descripcion: `Cierre ${periodo} - Costo de ventas`,
          lineas: lineasCierreCOGS(Math.round(costoTotal)),
          usuarioId: ctx.userId ?? undefined,
          creadoPor: "cierre_automatico",
        });

        if (cogsId) asientosCierre.push({ tipo: "COSTO_VENTA", id: cogsId });
      }
    }
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "SETTINGS",
    entityType: "cierre_mes",
    changeDescription: `Cierre de mes ${periodo}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json({
    mes_cerrado: periodo,
    desde,
    hasta,
    numero_asientos: entries?.length ?? 0,
    total_debitos: Math.round(totalDebitos * 100) / 100,
    total_creditos: Math.round(totalCreditos * 100) / 100,
    balanceado: Math.abs(totalDebitos - totalCreditos) < 0.01,
    asientos_cierre: asientosCierre,
  }, { status: 201 });
}
