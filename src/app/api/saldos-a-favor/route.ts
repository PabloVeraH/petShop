import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { SaldosFavorUsageSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
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

  if (error) {
    return NextResponse.json({ saldo_disponible: 0 });
  }

  return NextResponse.json({ saldo_disponible: saldo?.saldo_disponible ?? 0 });
}

export async function POST(req: NextRequest) {
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

  const { data: saldo, error: saldoError } = await supabase
    .from("saldos_a_favor")
    .select("saldo_disponible")
    .eq("cliente_id", clienteId)
    .eq("store_id", store_id)
    .single();

  const saldoDisponible = saldo?.saldo_disponible ?? 0;
  if (saldoDisponible < monto) {
    return NextResponse.json(
      { error: `Saldo insuficiente. Disponible: $${saldoDisponible}` },
      { status: 400 }
    );
  }

  const { data: pago, error: pagoError } = await supabase
    .from("pagos")
    .insert({
      store_id,
      venta_id: ventaId,
      metodo: "saldo_a_favor",
      monto,
      numero_transaccion: null,
    })
    .select("id")
    .single();

  if (pagoError) {
    return NextResponse.json({ error: "Error registering payment" }, { status: 500 });
  }

  const nuevoSaldo = saldoDisponible - monto;
  const { error: updateError } = await supabase
    .from("saldos_a_favor")
    .update({ saldo_disponible: nuevoSaldo })
    .eq("cliente_id", clienteId)
    .eq("store_id", store_id);

  if (updateError) {
    return NextResponse.json({ error: "Error updating balance" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    pagoId: pago?.id,
    saldoDisponibleAnterior: saldoDisponible,
    montoUsado: monto,
    saldoDisponibleNuevo: nuevoSaldo,
  });
}
