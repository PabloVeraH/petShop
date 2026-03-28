import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mascotaId = req.nextUrl.searchParams.get("mascotaId");
  if (!mascotaId) return NextResponse.json({ error: "mascotaId requerido" }, { status: 400 });

  const supabase = createServiceClient();

  // Verify mascota belongs to user's store
  const { data: user } = await supabase
    .from("clerk_users")
    .select("store_id")
    .eq("clerk_id", userId)
    .single();
  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

  const { data, error } = await supabase
    .from("consumo_configs")
    .select("id, mascota_id, producto_id, gramos_porcion, veces_dia, productos(nombre, peso_gramos)")
    .eq("mascota_id", mascotaId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users")
    .select("store_id")
    .eq("clerk_id", userId)
    .single();
  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

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
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase.from("consumo_configs").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
