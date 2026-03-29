import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { id } = await params;

  const { data: cliente, error } = await supabase
    .from("clientes")
    .select(`
      id, store_id, rut, nombre, email, telefono,
      mascotas(id, nombre, tipo, raza, peso_kg, alimento_habitual_id)
    `)
    .eq("id", id)
    .eq("store_id", store_id)
    .single();

  if (error?.code === "PGRST116") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: ventas } = await supabase
    .from("ventas")
    .select("id, total, metodo_pago, created_at")
    .eq("store_id", store_id)
    .eq("cliente_id", id)
    .neq("estado", "anulada")
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({ ...cliente, ventas: ventas ?? [] });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { id } = await params;

  const body = await req.json();
  const { nombre, email, telefono } = body;

  if (nombre !== undefined && !nombre?.trim())
    return NextResponse.json({ error: "Nombre no puede estar vacío" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (nombre !== undefined) updates.nombre = nombre.trim();
  if (email !== undefined) updates.email = email?.trim() || null;
  if (telefono !== undefined) updates.telefono = telefono?.trim() || null;

  const { data, error } = await supabase
    .from("clientes")
    .update(updates)
    .eq("id", id)
    .eq("store_id", store_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
