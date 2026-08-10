import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { SaldosFavorUsageSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const clienteId = req.nextUrl.searchParams.get("clienteId");
  if (!clienteId) return NextResponse.json({ error: "clienteId required" }, { status: 400 });

  const { data: saldo, error } = await supabase
    .from("saldos_a_favor")
    .select("saldo_disponible")
    .eq("cliente_id", clienteId)
    .eq("store_id", store_id)
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: "Error consultando saldo" }, { status: 500 });
  }

  return NextResponse.json({ saldo_disponible: saldo?.saldo_disponible ?? 0 });
}, { endpoint: "GET /api/saldos-a-favor" });

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const body = await req.json();
  const parsed = SaldosFavorUsageSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { clienteId, ventaId, monto } = parsed.data;

  const supabase = createServiceClient();

  // Decremento + registro de pago en una sola transacción atómica (RPC):
  // el UPDATE es condicional (saldo_disponible >= monto) y se evalúa bajo el
  // lock de fila, por lo que dos requests concurrentes para el mismo cliente
  // se serializan — cierra el doble gasto real que existía con el patrón
  // previo de SELECT en JS seguido de UPDATE con el valor calculado en la app.
  const { data: rpcRows, error: rpcError } = await supabase.rpc("gastar_saldo_a_favor_pago", {
    p_store_id: store_id,
    p_cliente_id: clienteId,
    p_venta_id: ventaId,
    p_monto: monto,
  });

  if (rpcError) {
    return NextResponse.json({ error: "Error registrando el pago con saldo a favor" }, { status: 500 });
  }

  const resultado = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  if (!resultado) {
    const { data: saldo } = await supabase
      .from("saldos_a_favor")
      .select("saldo_disponible")
      .eq("cliente_id", clienteId)
      .eq("store_id", store_id)
      .single();

    return NextResponse.json(
      { error: `Saldo insuficiente. Disponible: $${saldo?.saldo_disponible ?? 0}` },
      { status: 400 }
    );
  }

  const { pago_id: pagoId, saldo_nuevo: saldoNuevo } = resultado as { pago_id: string; saldo_nuevo: number };

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "CREATE",
    entityType: "saldo_favor",
    entityId: pagoId,
    newValues: { clienteId, ventaId, monto },
    changeDescription: `Uso de saldo a favor: $${monto} para venta ${ventaId}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    pagoId,
    montoUsado: monto,
    saldoDisponibleNuevo: saldoNuevo,
  });
}, { endpoint: "POST /api/saldos-a-favor" });
