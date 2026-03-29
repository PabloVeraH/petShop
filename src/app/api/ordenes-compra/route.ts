import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const estado = req.nextUrl.searchParams.get("estado") ?? "";

  let query = supabase
    .from("ordenes_compra")
    .select("id, numero, estado, total, fecha_estimada, fecha_recibida, created_at, proveedores(nombre)")
    .eq("store_id", store_id)
    .order("created_at", { ascending: false });
  if (estado) query = query.eq("estado", estado);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { proveedor_id, items, fecha_estimada, notas } = await req.json();
  if (!proveedor_id || !items?.length) return NextResponse.json({ error: "Faltan campos" }, { status: 400 });

  const subtotal: number = items.reduce((s: number, i: { subtotal: number }) => s + i.subtotal, 0);
  const impuesto = subtotal * 0.19;
  const total = subtotal * 1.19;
  const hoy = new Date();
  const numero = `OC-${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}${String(hoy.getDate()).padStart(2, "0")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  const { data: orden, error: ordenError } = await supabase
    .from("ordenes_compra")
    .insert({ store_id, proveedor_id, numero, estado: "pendiente", subtotal, impuesto, total, fecha_estimada: fecha_estimada || null, notas: notas || null })
    .select().single();
  if (ordenError) return NextResponse.json({ error: ordenError.message }, { status: 500 });

  const { error: itemsError } = await supabase.from("ordenes_compra_items").insert(
    items.map((i: { producto_id: string; cantidad_solicitada: number; precio_unitario: number; subtotal: number }) => ({
      orden_id: orden.id,
      producto_id: i.producto_id,
      cantidad_solicitada: i.cantidad_solicitada,
      precio_unitario: i.precio_unitario,
      subtotal: i.subtotal,
    }))
  );
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

  return NextResponse.json(orden);
}
