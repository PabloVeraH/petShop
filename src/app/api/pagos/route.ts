import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { PagoSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = PagoSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { ventaId, monto, metodoPago } = parsed.data;
  const metodo = metodoPago;
  const numeroTransaccion = body.numeroTransaccion;
  const comprobante = body.comprobante;

  // Verificar que la venta existe y pertenece a esta tienda
  const { data: venta, error: ventaError } = await supabase
    .from("ventas")
    .select("id, total, store_id, estado")
    .eq("id", ventaId)
    .eq("store_id", store_id)
    .single();

  if (ventaError || !venta) {
    return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
  }

  // Validar que el monto no exceda el total de la venta
  if (monto > venta.total) {
    return NextResponse.json(
      { error: `Monto no puede exceder total de venta (${venta.total})` },
      { status: 400 }
    );
  }

   // Registrar pago
   const { data: pago, error: pagoError } = await supabase
     .from("pagos")
     .insert({
       store_id,
       venta_id: ventaId,
       metodo,
       monto,
       numero_transaccion: numeroTransaccion ?? null,
       comprobante: comprobante ?? null,
     })
     .select()
     .single();

    if (pagoError) {
      await logAudit({
        storeId: store_id,
        userId: ctx.userId || "unknown",
        action: "CREATE",
        entityType: "pago",
        newValues: { ventaId, metodo, monto, numeroTransaccion, comprobante },
        ipAddress: (await getRequestMetadata(req)).ipAddress,
        userAgent: (await getRequestMetadata(req)).userAgent,
        result: "failure",
        errorMessage: pagoError.message,
      });
      return NextResponse.json({ error: "Error registrando pago" }, { status: 500 });
    }

    // Log successful pago creation
    await logAudit({
      storeId: store_id,
      userId: ctx.userId || "unknown",
      action: "CREATE",
      entityType: "pago",
      entityId: pago.id,
      newValues: pago,
      changeDescription: `Pago registrado para venta ${ventaId} por $${monto} via ${metodo}`,
      ipAddress: (await getRequestMetadata(req)).ipAddress,
      userAgent: (await getRequestMetadata(req)).userAgent,
      result: "success",
    });

  // Actualizar estado de venta a "pagada" si el monto cubre el total
  const { data: pagosVenta } = await supabase
    .from("pagos")
    .select("monto")
    .eq("venta_id", ventaId);

  const totalPagado = (pagosVenta ?? []).reduce((sum, p) => sum + Number(p.monto), 0);

  if (totalPagado >= venta.total) {
    await supabase
      .from("ventas")
      .update({ estado: "pagada" })
      .eq("id", ventaId);
  }

  return NextResponse.json({
    ok: true,
    pagoId: pago.id,
    metodo: pago.metodo,
    monto: pago.monto,
  });
}

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const ventaId = req.nextUrl.searchParams.get("ventaId");
  if (!ventaId) {
    return NextResponse.json({ error: "ventaId requerido" }, { status: 400 });
  }

  const { data: pagos, error } = await supabase
    .from("pagos")
    .select("id, metodo, monto, numero_transaccion, comprobante, created_at")
    .eq("venta_id", ventaId)
    .eq("store_id", store_id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Error consultando pagos" }, { status: 500 });
  }

  return NextResponse.json({ data: pagos ?? [] });
}
