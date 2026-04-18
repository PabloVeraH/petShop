import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { CuentasPagarUpdateSchema } from "@/lib/validation";
import { crearAsiento, lineasPagoProveedor } from "@/lib/contabilidad/generador-asientos";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const estado = req.nextUrl.searchParams.get("estado") ?? "";

  let query = supabase
    .from("cuentas_pagar")
    .select("id, monto, fecha_emision, fecha_vencimiento, estado, proveedores(nombre), ordenes_compra(numero)")
    .eq("store_id", store_id)
    .order("fecha_vencimiento");
  if (estado) query = query.eq("estado", estado);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function PATCH(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const body = await req.json();
  const parsed = CuentasPagarUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { estado } = parsed.data;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("cuentas_pagar")
    .update({ estado })
    .eq("id", id)
    .eq("store_id", store_id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  if (estado === "pagada" && data) {
    crearAsiento({
      storeId: store_id,
      fecha: data.updated_at?.split("T")[0] ?? new Date().toISOString().split("T")[0],
      tipoMovimiento: "PAGO_PROVEEDOR",
      referenciaId: data.id,
      descripcion: `Pago proveedor - Cuenta ${id}`,
      lineas: lineasPagoProveedor(Number(data.monto)),
      usuarioId: ctx.userId ?? undefined,
    }).catch((e) => console.error("[contabilidad] Error asiento pago proveedor:", e));
  }

  return NextResponse.json(data);
}
