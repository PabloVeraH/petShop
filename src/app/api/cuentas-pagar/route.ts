import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users").select("store_id").eq("clerk_id", userId).single();
  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

  const estado = req.nextUrl.searchParams.get("estado") ?? "";

  let query = supabase
    .from("cuentas_pagar")
    .select("id, monto, fecha_emision, fecha_vencimiento, estado, proveedores(nombre), ordenes_compra(numero)")
    .eq("store_id", user.store_id)
    .order("fecha_vencimiento");
  if (estado) query = query.eq("estado", estado);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const body = await req.json();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("cuentas_pagar").update(body).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
