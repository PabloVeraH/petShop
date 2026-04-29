import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json([], { status: 401 });

  const clienteId = req.nextUrl.searchParams.get("clienteId");
  if (!clienteId) return NextResponse.json([], { status: 400 });

  const supabase = createServiceClient();

  const { data: cliente } = await supabase
    .from("clientes")
    .select("id")
    .eq("id", clienteId)
    .eq("store_id", ctx.storeId)
    .single();
  if (!cliente) return NextResponse.json([], { status: 403 });

  const { data } = await supabase
    .from("consumo_configs")
    .select("mascota_id, producto_id, gramos_porcion, veces_dia")
    .eq("cliente_id", clienteId);

  return NextResponse.json(data ?? []);
}