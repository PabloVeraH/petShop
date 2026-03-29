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

  const search = req.nextUrl.searchParams.get("search") ?? "";
  let query = supabase
    .from("proveedores")
    .select("id, nombre, rut, contacto, telefono, email")
    .eq("store_id", user.store_id)
    .order("nombre");
  if (search) query = query.ilike("nombre", `%${search}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users").select("store_id").eq("clerk_id", userId).single();
  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

  const { nombre, rut, contacto, telefono, email } = await req.json();
  if (!nombre?.trim()) return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });

  const { data, error } = await supabase
    .from("proveedores")
    .insert({ store_id: user.store_id, nombre: nombre.trim(), rut: rut || null, contacto: contacto || null, telefono: telefono || null, email: email || null })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase.from("proveedores").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
