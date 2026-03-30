import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const { id } = await params;
  const supabase = createServiceClient();

  // Verify mascota belongs to this store via cliente
  const { data: mascota } = await supabase
    .from("mascotas")
    .select("id, cliente_id")
    .eq("id", id)
    .single();

  if (!mascota) return NextResponse.json({ error: "Mascota no encontrada" }, { status: 404 });

  const { data: cliente } = await supabase
    .from("clientes")
    .select("id")
    .eq("id", mascota.cliente_id)
    .eq("store_id", store_id)
    .single();

  if (!cliente) return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });

  const body = await req.json();
  const { nombre, tipo, raza, peso_kg } = body;

  if (nombre !== undefined && !nombre?.trim())
    return NextResponse.json({ error: "Nombre no puede estar vacío" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (nombre !== undefined) updates.nombre = nombre.trim();
  if (tipo !== undefined) updates.tipo = tipo?.trim() || null;
  if (raza !== undefined) updates.raza = raza?.trim() || null;
  if (peso_kg !== undefined) updates.peso_kg = peso_kg ? Number(peso_kg) : null;

  const { data, error } = await supabase
    .from("mascotas")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data);
}
