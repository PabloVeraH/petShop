import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { MascotaUpdateSchema } from "@/lib/validation";

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
  const parsed = MascotaUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { nombre, tipo, raza, peso_kg, alimento_habitual_id, gramos_porcion, veces_dia } = parsed.data;

  const updates: Record<string, unknown> = {};
  if (nombre !== undefined) updates.nombre = nombre.trim();
  if (tipo !== undefined) updates.tipo = tipo?.trim() || null;
  if (raza !== undefined) updates.raza = raza?.trim() || null;
  if (peso_kg !== undefined) updates.peso_kg = peso_kg ? Number(peso_kg) : null;
  if (alimento_habitual_id !== undefined) updates.alimento_habitual_id = alimento_habitual_id ?? null;
  if (gramos_porcion !== undefined) updates.gramos_porcion = gramos_porcion ? Number(gramos_porcion) : null;
  if (veces_dia !== undefined) updates.veces_dia = veces_dia ? Number(veces_dia) : null;

  const { data, error } = await supabase
    .from("mascotas")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data);
}
