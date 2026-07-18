import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { crearAsiento, lineasCierreCOGS } from "@/lib/contabilidad/generador-asientos";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { computeCierrePreview, checkExistingCierre } from "@/lib/contabilidad/cierre-mes";

const CierreMesSchema = z.object({
  mes: z.number().int().min(1).max(12),
  año: z.number().int().min(2020).max(2100),
  calcular_costo_venta: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  try {
    requireStoreAdmin(admin, store_id);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  // Compute preview data: checks existing cierre, period totals, COGS estimate
  const preview = await computeCierrePreview(supabase, store_id, mes, año, calcular_costo_venta);

  if (preview.ya_tiene_cierre) {
    console.warn(
      `[cierre-mes] Intento duplicado para ${periodo} (store=${store_id}, usuario=${ctx.userId})`
    );
    return NextResponse.json(
      { error: `El período ${periodo} ya tiene un asiento de cierre` },
      { status: 409 }
    );
  }

  const asientosCierre: Array<{ tipo: string; id: string }> = [];

  if (calcular_costo_venta && preview.cogs_estimado > 0) {
    // Respaldo automático antes de la mutación irreversible. Si el
    // respaldo no puede confirmarse, se aborta ANTES de crear el asiento
    // irreversible — el objetivo de "respaldar antes de mutar" se pierde
    // por completo si se continúa sin backup ante un fallo silencioso.
    const respaldoOk = await tomarRespaldoCierre(supabase, store_id, periodo, preview);
    if (!respaldoOk) {
      console.error(
        `[cierre-mes] No se pudo crear el respaldo para ${periodo} (store=${store_id}) — se aborta antes de generar el asiento irreversible`
      );
      return NextResponse.json(
        { error: `No se pudo crear el respaldo del período ${periodo}. El cierre no se ejecutó.` },
        { status: 500 }
      );
    }

    const cogsId = await crearAsiento({
      storeId: store_id,
      fecha: hasta,
      tipoMovimiento: "CIERRE_MES",
      referenciaNomero: periodo,
      descripcion: `Cierre ${periodo} - Costo de ventas`,
      lineas: lineasCierreCOGS(preview.cogs_estimado),
      usuarioId: ctx.userId ?? undefined,
      creadoPor: "cierre_automatico",
    });

    if (cogsId) {
      asientosCierre.push({ tipo: "COSTO_VENTA", id: cogsId });

      // Vincular respaldo con el asiento de cierre creado. El asiento ya
      // fue creado en este punto — un fallo aquí no debe abortar la
      // respuesta exitosa (el respaldo sigue existiendo, solo queda sin
      // vincular), pero sí debe quedar registrado para diagnóstico.
      const { error: linkError } = await supabase
        .from("cierre_mes_backups")
        .update({ cierre_asiento_id: cogsId })
        .eq("store_id", store_id)
        .eq("periodo", periodo);

      if (linkError) {
        console.error(`[cierre-mes] No se pudo vincular el respaldo de ${periodo} con el asiento ${cogsId}:`, linkError.message);
      }
    } else {
      const concurrentes = await checkExistingCierre(supabase, store_id, periodo);

      if (concurrentes > 0) {
        console.warn(
          `[cierre-mes] Carrera detectada para ${periodo}: otro request cerró el período mientras este procesaba`
        );
        return NextResponse.json(
          { error: `El período ${periodo} ya fue cerrado por otra operación concurrente` },
          { status: 409 }
        );
      }

      console.error(
        `[cierre-mes] Error al crear asiento de cierre COGS para ${periodo} (store=${store_id}, cogsEstimado=${preview.cogs_estimado})`
      );
      return NextResponse.json(
        { error: `Error al generar el asiento de costo de ventas para ${periodo}` },
        { status: 500 }
      );
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
    numero_asientos: preview.numero_asientos,
    total_debitos: preview.total_debitos,
    total_creditos: preview.total_creditos,
    balanceado: preview.balanceado,
    asientos_cierre: asientosCierre,
  }, { status: 201 });
}

// Retorna true solo si el respaldo se persistió correctamente. El llamador
// debe abortar la mutación irreversible si retorna false — un respaldo que
// falla en silencio (error de BD ignorado) invalida por completo la
// garantía de "backup antes de cerrar".
async function tomarRespaldoCierre(
  supabase: ReturnType<typeof createServiceClient>,
  storeId: string,
  periodo: string,
  preview: { desde: string; hasta: string; numero_asientos: number; total_debitos: number; total_creditos: number; cogs_estimado: number }
): Promise<boolean> {
  const { data: entries, error: entriesError } = await supabase
    .from("journal_entries")
    .select("*, journal_detail(*)")
    .eq("store_id", storeId)
    .gte("fecha", preview.desde)
    .lte("fecha", preview.hasta);

  if (entriesError) {
    console.error(`[cierre-mes] Error al leer asientos para el respaldo de ${periodo}:`, entriesError.message);
    return false;
  }

  const { error: insertError } = await supabase.from("cierre_mes_backups").insert({
    store_id: storeId,
    periodo,
    asientos_count: preview.numero_asientos,
    total_debitos: preview.total_debitos,
    total_creditos: preview.total_creditos,
    cogs_estimado: preview.cogs_estimado,
    // Objeto plano, no stringificado — el cliente serializa hacia la
    // columna JSONB; stringificar aquí lo guardaría como un string escapado
    // dentro del jsonb en vez de un array real.
    snapshot: entries ?? [],
  });

  if (insertError) {
    console.error(`[cierre-mes] Error al insertar el respaldo de ${periodo}:`, insertError.message);
    return false;
  }

  return true;
}
