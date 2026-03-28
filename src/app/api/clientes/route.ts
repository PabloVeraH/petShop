import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { validateRUT, formatRUT } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users")
    .select("store_id")
    .eq("clerk_id", userId)
    .single();

  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

  const rut = req.nextUrl.searchParams.get("rut");

  // Single lookup by RUT (used by POS)
  if (rut) {
    const { data, error } = await supabase
      .from("clientes")
      .select("id, store_id, rut, nombre, email, telefono")
      .eq("store_id", user.store_id)
      .eq("rut", rut)
      .single();

    if (error?.code === "PGRST116") return NextResponse.json(null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // List with optional search + pagination
  const search = req.nextUrl.searchParams.get("search") ?? "";
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");
  const limit = 50;

  let query = supabase
    .from("clientes")
    .select("id, store_id, rut, nombre, email, telefono", { count: "exact" })
    .eq("store_id", user.store_id)
    .order("nombre", { ascending: true });

  if (search.trim()) {
    query = query.or(`nombre.ilike.%${search}%,rut.ilike.%${search}%`);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [], count: count ?? 0 });
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

  const { rut, nombre, email, telefono } = await req.json();

  if (!validateRUT(rut)) {
    return NextResponse.json({ error: "RUT inválido" }, { status: 400 });
  }
  if (!nombre || nombre.trim().length < 3) {
    return NextResponse.json({ error: "Nombre debe tener al menos 3 caracteres" }, { status: 400 });
  }

  const { data: cliente, error } = await supabase
    .from("clientes")
    .insert({
      store_id: user.store_id,
      rut: formatRUT(rut),
      nombre: nombre.trim(),
      email: email?.trim() || null,
      telefono: telefono?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ya existe un cliente con ese RUT" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Auto-create fidelizacion entry
  await supabase.from("fidelizacion").insert({ cliente_id: cliente.id });

  return NextResponse.json(cliente, { status: 201 });
}
