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

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: proveedor, error } = await supabase
    .from("proveedores")
    .select("id, nombre, rut, contacto, telefono, email")
    .eq("id", id)
    .eq("store_id", store_id)
    .single();
  if (error || !proveedor) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const { data: productos } = await supabase
    .from("proveedor_productos")
    .select("id, costo, tiempo_entrega_dias, productos(id, nombre, sku, stock)")
    .eq("proveedor_id", id);

  return NextResponse.json({ ...proveedor, productos: productos ?? [] });
}
