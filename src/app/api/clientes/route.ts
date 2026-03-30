import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { validateRUT, formatRUT } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const rut = req.nextUrl.searchParams.get("rut");

  // Single lookup by RUT (used by POS)
  if (rut) {
    const { data, error } = await supabase
      .from("clientes")
      .select("id, store_id, rut, nombre, email, telefono")
      .eq("store_id", store_id)
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
    .eq("store_id", store_id)
    .order("nombre", { ascending: true });

  if (search.trim()) {
    // Sanitize to prevent PostgREST filter string manipulation
    const s = search.replace(/[()%,]/g, "");
    query = query.or(`nombre.ilike.%${s}%,rut.ilike.%${s}%`);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [], count: count ?? 0 });
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

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
      store_id,
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
