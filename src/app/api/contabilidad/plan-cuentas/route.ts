import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { z } from "zod";
import { CUENTAS } from "@/lib/contabilidad/types";

const CuentaSchema = z.object({
  codigo: z.string().min(1).max(20),
  nombre: z.string().min(2).max(255),
  descripcion: z.string().max(500).optional(),
  tipo: z.enum(["ACTIVO", "PASIVO", "PATRIMONIO", "INGRESO", "GASTO"]),
  subtipo: z.string().max(50).optional(),
  requiere_conciliacion: z.boolean().optional(),
  saldo_inicial: z.number().optional(),
});

// Plan de cuentas base para carga inicial
const PLAN_BASE = [
  { codigo: "110101", nombre: "Caja Operacional", tipo: "ACTIVO", subtipo: "CIRCULANTE" },
  { codigo: "110102", nombre: "Caja de Cambio", tipo: "ACTIVO", subtipo: "CIRCULANTE" },
  { codigo: "110201", nombre: "Banco Operacional", tipo: "ACTIVO", subtipo: "CIRCULANTE", requiere_conciliacion: true },
  { codigo: "110202", nombre: "Banco Secundario", tipo: "ACTIVO", subtipo: "CIRCULANTE", requiere_conciliacion: true },
  { codigo: "110501", nombre: "Clientes por Cobrar", tipo: "ACTIVO", subtipo: "CIRCULANTE" },
  { codigo: "110502", nombre: "Saldos a Favor Clientes", tipo: "ACTIVO", subtipo: "CIRCULANTE" },
  { codigo: "110601", nombre: "IVA Crédito Fiscal", tipo: "ACTIVO", subtipo: "CIRCULANTE" },
  { codigo: "111001", nombre: "Inventario de Productos", tipo: "ACTIVO", subtipo: "CIRCULANTE" },
  { codigo: "111002", nombre: "Existencias en Tránsito", tipo: "ACTIVO", subtipo: "CIRCULANTE" },
  { codigo: "120501", nombre: "Muebles y Enseres", tipo: "ACTIVO", subtipo: "NO_CIRCULANTE" },
  { codigo: "120502", nombre: "Equipos de Computación", tipo: "ACTIVO", subtipo: "NO_CIRCULANTE" },
  { codigo: "210101", nombre: "Proveedores", tipo: "PASIVO", subtipo: "CIRCULANTE" },
  { codigo: "210102", nombre: "Otros Pasivos Corrientes", tipo: "PASIVO", subtipo: "CIRCULANTE" },
  { codigo: "210501", nombre: "IVA por Pagar", tipo: "PASIVO", subtipo: "CIRCULANTE" },
  { codigo: "210502", nombre: "Impuesto a la Renta Retenido", tipo: "PASIVO", subtipo: "CIRCULANTE" },
  { codigo: "310101", nombre: "Capital Social", tipo: "PATRIMONIO", subtipo: "CAPITAL" },
  { codigo: "320101", nombre: "Ganancias Acumuladas", tipo: "PATRIMONIO", subtipo: "RESULTADOS" },
  { codigo: "320102", nombre: "Pérdidas Acumuladas", tipo: "PATRIMONIO", subtipo: "RESULTADOS" },
  { codigo: "410101", nombre: "Venta de Productos", tipo: "INGRESO", subtipo: "OPERACIONAL" },
  { codigo: "410102", nombre: "Devoluciones en Ventas", tipo: "INGRESO", subtipo: "OPERACIONAL" },
  { codigo: "410103", nombre: "Descuentos Otorgados", tipo: "INGRESO", subtipo: "OPERACIONAL" },
  { codigo: "420101", nombre: "Otros Ingresos", tipo: "INGRESO", subtipo: "NO_OPERACIONAL" },
  { codigo: "510101", nombre: "Costo de Bienes Vendidos", tipo: "GASTO", subtipo: "OPERACIONAL" },
  { codigo: "520101", nombre: "Gasto en Servicios", tipo: "GASTO", subtipo: "OPERACIONAL" },
  { codigo: "520102", nombre: "Gasto en Remuneraciones", tipo: "GASTO", subtipo: "OPERACIONAL" },
  { codigo: "520103", nombre: "Gasto en Transporte", tipo: "GASTO", subtipo: "OPERACIONAL" },
  { codigo: "530101", nombre: "Gasto por Intereses", tipo: "GASTO", subtipo: "FINANCIERO" },
  { codigo: "530102", nombre: "Gasto por Comisiones Bancarias", tipo: "GASTO", subtipo: "FINANCIERO" },
] as const;

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const tipo = req.nextUrl.searchParams.get("tipo") ?? "";

  let query = supabase
    .from("chart_of_accounts")
    .select("*")
    .eq("store_id", store_id)
    .eq("activo", true)
    .order("codigo");

  if (tipo) query = query.eq("tipo", tipo);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  return NextResponse.json({ data: data ?? [], total: data?.length ?? 0 });
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const body = await req.json();

  // Acción especial: cargar plan base
  if (body.action === "cargar_plan_base") {
    const rows = PLAN_BASE.map((c) => ({
      store_id,
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      subtipo: c.subtipo,
      requiere_conciliacion: "requiere_conciliacion" in c ? c.requiere_conciliacion : false,
      saldo_inicial: 0,
      saldo_actual: 0,
    }));

    const { error } = await supabase
      .from("chart_of_accounts")
      .upsert(rows, { onConflict: "store_id,codigo" });

    if (error) return NextResponse.json({ error: "Error cargando plan base" }, { status: 500 });
    return NextResponse.json({ ok: true, cuentas_cargadas: rows.length }, { status: 201 });
  }

  const parsed = CuentaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("chart_of_accounts")
    .insert({ store_id, ...parsed.data })
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Error creando cuenta" }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
