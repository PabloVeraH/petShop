import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const productoId = req.nextUrl.searchParams.get("productoId");
  if (!productoId) return NextResponse.json({ error: "productoId requerido" }, { status: 400 });

  // Verify product belongs to this store
  const { data: producto } = await supabase
    .from("productos")
    .select("id")
    .eq("id", productoId)
    .eq("store_id", store_id)
    .single();
  if (!producto) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const { data, error } = await supabase
    .from("stock_movements")
    .select("id, tipo, cantidad, notas, created_at")
    .eq("producto_id", productoId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data ?? []);
}
