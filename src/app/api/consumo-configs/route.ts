import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const mascotaId = req.nextUrl.searchParams.get("mascotaId");
  if (!mascotaId) return NextResponse.json({ error: "mascotaId requerido" }, { status: 400 });

  const { data, error } = await supabase
    .from("consumo_configs")
    .select("id, mascota_id, producto_id, gramos_porcion, veces_dia, productos(nombre, peso_gramos)")
    .eq("mascota_id", mascotaId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createServiceClient();

  const body = await req.json();
  const { mascota_id, producto_id, gramos_porcion, veces_dia } = body;

  if (!mascota_id || !producto_id || !gramos_porcion || !veces_dia) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  // Get cliente_id from mascota
  const { data: mascota } = await supabase
    .from("mascotas")
    .select("cliente_id")
    .eq("id", mascota_id)
    .single();
  if (!mascota) return NextResponse.json({ error: "Mascota no encontrada" }, { status: 404 });

  const { data, error } = await supabase
    .from("consumo_configs")
    .upsert(
      {
        mascota_id,
        cliente_id: mascota.cliente_id,
        producto_id,
        gramos_porcion: Number(gramos_porcion),
        veces_dia: Number(veces_dia),
      },
      { onConflict: "mascota_id,producto_id" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const supabase = createServiceClient();

  // Verify ownership via cliente → store
  const { data: config } = await supabase
    .from("consumo_configs")
    .select("id, cliente_id")
    .eq("id", id)
    .single();
  if (!config) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const { data: cliente } = await supabase
    .from("clientes")
    .select("id")
    .eq("id", config.cliente_id)
    .eq("store_id", store_id)
    .single();
  if (!cliente) return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });

  const { error } = await supabase.from("consumo_configs").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
