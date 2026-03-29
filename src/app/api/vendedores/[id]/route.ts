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

  const { nombre, rut, meta_ventas } = await req.json();
  if (nombre !== undefined && !nombre?.trim()) {
    return NextResponse.json({ error: "Nombre no puede estar vacío" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (nombre !== undefined) updates.nombre = nombre.trim();
  if (rut !== undefined) updates.rut = rut?.trim() || null;
  if (meta_ventas !== undefined) updates.meta_ventas = meta_ventas ? Number(meta_ventas) : null;

  const { data, error } = await supabase
    .from("vendedores")
    .update(updates)
    .eq("id", id)
    .eq("store_id", store_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Vendedor no encontrado" }, { status: 404 });

  return NextResponse.json(data);
}
