import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { VendedorUpdateSchema } from "@/lib/validation";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const { id } = await params;
  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = VendedorUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { nombre, telefono, activo } = parsed.data;
  const rut = body.rut;
  const meta_ventas = body.meta_ventas;

  const updates: Record<string, unknown> = {};
  if (nombre !== undefined) updates.nombre = nombre.trim();
  if (rut !== undefined) updates.rut = rut?.trim() || null;
  if (meta_ventas !== undefined) updates.meta_ventas = meta_ventas ? Number(meta_ventas) : null;
  if (telefono !== undefined) updates.telefono = telefono;
  if (activo !== undefined) updates.activo = activo;

  const { data, error } = await supabase
    .from("vendedores")
    .update(updates)
    .eq("id", id)
    .eq("store_id", store_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Vendedor no encontrado" }, { status: 404 });

  return NextResponse.json(data);
}
