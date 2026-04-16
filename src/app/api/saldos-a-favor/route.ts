import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

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
