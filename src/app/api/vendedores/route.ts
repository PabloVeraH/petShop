import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  // Fetch vendedores with their monthly sales total
  const { data: vendedores, error } = await supabase
    .from("vendedores")
    .select("id, nombre, rut, meta_ventas")
    .eq("store_id", store_id)
    .order("nombre");
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  // Get monthly sales per vendedor
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: ventas } = await supabase
    .from("ventas")
    .select("vendedor_id, total")
    .eq("store_id", store_id)
    .neq("estado", "anulada")
    .gte("created_at", startOfMonth.toISOString());

  const totalesMes: Record<string, number> = {};
  for (const v of ventas ?? []) {
    if (v.vendedor_id) {
      totalesMes[v.vendedor_id] = (totalesMes[v.vendedor_id] ?? 0) + Number(v.total);
    }
  }

  const result = (vendedores ?? []).map((v) => ({
    ...v,
    ventas_mes: totalesMes[v.id] ?? 0,
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { nombre, rut, meta_ventas } = await req.json();
  if (!nombre?.trim()) return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });

  const { data, error } = await supabase
    .from("vendedores")
    .insert({ store_id, nombre: nombre.trim(), rut: rut?.trim() || null, meta_ventas: meta_ventas ? Number(meta_ventas) : null })
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase.from("vendedores").delete().eq("id", id).eq("store_id", store_id);
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
