import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { CuentasPagarUpdateSchema } from "@/lib/validation";
import { crearAsiento, lineasPagoProveedor } from "@/lib/contabilidad/generador-asientos";
import { logAudit, getRequestMetadata } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const estado = req.nextUrl.searchParams.get("estado") ?? "";
  const proveedor_id = req.nextUrl.searchParams.get("proveedor_id") ?? "";

  let query = supabase
    .from("cuentas_pagar")
    .select("id, monto, fecha_emision, fecha_vencimiento, estado, proveedores(nombre), ordenes_compra(numero)")
    .eq("store_id", store_id)
    .gt("monto", 0)
    .order("fecha_vencimiento");
  if (estado) query = query.eq("estado", estado);
  if (proveedor_id) query = query.eq("proveedor_id", proveedor_id);

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

  const { estado, metodo_pago } = parsed.data;

  const supabase = createServiceClient();

  const { data: cuentaAnterior } = await supabase
    .from("cuentas_pagar")
    .select("id, estado")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();

  const updateData: Record<string, string> = { estado };
  if (metodo_pago) updateData.metodo_pago = metodo_pago;

  const { data, error } = await supabase
    .from("cuentas_pagar")
    .update(updateData)
    .eq("id", id)
    .eq("store_id", store_id)
    .select()
    .single();
  if (error) {
    const { ipAddress, userAgent } = getRequestMetadata(req);
    console.error("[cuentas-pagar] Error en PATCH:", error.message, { id, store_id, updateData });
    logAudit({
      storeId: store_id,
      userId: ctx.userId,
      action: "UPDATE",
      entityType: "cuenta_pagar",
      entityId: id,
      changeDescription: "Error actualizando cuenta por pagar",
      ipAddress,
      userAgent,
      result: "failure",
      errorMessage: error.message,
    }).catch(() => {});
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "cuenta_pagar",
    entityId: id,
    oldValues: cuentaAnterior ? { estado: cuentaAnterior.estado } : undefined,
    newValues: { estado },
    changeDescription: `Cuenta por pagar marcada como ${estado}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  if (estado === "pagada" && data) {
    // Asiento contable (post-response fire-and-forget)
    (async () => {
      let proveedorNombre: string | undefined;
      const { data: cp } = await supabase
        .from("cuentas_pagar")
        .select("proveedores(nombre)")
        .eq("id", data.id)
        .single();
      const rel = cp?.proveedores as unknown as { nombre: string } | null;
      proveedorNombre = rel?.nombre ?? undefined;

      const asiento = await crearAsiento({
        storeId: store_id,
        fecha: data.updated_at?.split("T")[0] ?? new Date().toISOString().split("T")[0],
        tipoMovimiento: "PAGO_PROVEEDOR",
        referenciaId: data.id,
        descripcion: `Pago${proveedorNombre ? ` a ${proveedorNombre}` : ""} — $${Number(data.monto).toLocaleString("es-CL")}`,
        lineas: lineasPagoProveedor(Number(data.monto), metodo_pago),
        usuarioId: ctx.userId ?? undefined,
      });
      if (!asiento) console.error(`[contabilidad] Asiento PAGO_PROVEEDOR NO CREADO para cuenta ${data.id}`);
    })().catch((e) => console.error("[contabilidad] Error en asiento pago proveedor:", e));
  }

  return NextResponse.json(data);
}
