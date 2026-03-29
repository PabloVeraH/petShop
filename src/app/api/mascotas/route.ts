import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { MascotaCreateSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const clienteId = req.nextUrl.searchParams.get("clienteId");
  if (!clienteId) return NextResponse.json({ error: "clienteId required" }, { status: 400 });

  // Verify cliente belongs to the user's store
  const { data: cliente } = await supabase
    .from("clientes")
    .select("id")
    .eq("id", clienteId)
    .eq("store_id", store_id)
    .single();

  if (!cliente) return NextResponse.json([]);

  const { data, error } = await supabase
    .from("mascotas")
    .select("id, cliente_id, nombre, tipo, raza, peso_kg, alimento_habitual_id")
    .eq("cliente_id", clienteId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = MascotaCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { cliente_id, nombre, tipo, raza, peso_kg, alimento_habitual_id } = parsed.data;

  // Verify cliente belongs to store
  const { data: cliente } = await supabase
    .from("clientes")
    .select("id")
    .eq("id", cliente_id)
    .eq("store_id", store_id)
    .single();

  if (!cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });

  const { data: mascota, error } = await supabase
    .from("mascotas")
    .insert({
      cliente_id,
      nombre,
      tipo,
      raza: raza ?? null,
      peso_kg: peso_kg ?? null,
      alimento_habitual_id: alimento_habitual_id ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(mascota, { status: 201 });
}
