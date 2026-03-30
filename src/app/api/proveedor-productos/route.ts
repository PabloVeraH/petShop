import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const { proveedor_id, producto_id, costo, tiempo_entrega_dias } = await req.json();
  if (!proveedor_id || !producto_id) return NextResponse.json({ error: "Faltan campos" }, { status: 400 });

  const supabase = createServiceClient();

  // Verify proveedor belongs to this store
  const { data: prov } = await supabase.from("proveedores").select("id").eq("id", proveedor_id).eq("store_id", store_id).single();
  if (!prov) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });

  const { data, error } = await supabase
    .from("proveedor_productos")
    .upsert(
      { proveedor_id, producto_id, costo: costo ? Number(costo) : null, tiempo_entrega_dias: tiempo_entrega_dias ? Number(tiempo_entrega_dias) : null },
      { onConflict: "proveedor_id,producto_id" }
    )
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const supabase = createServiceClient();

  // Verify ownership via proveedor
  const { data: pp } = await supabase.from("proveedor_productos").select("id, proveedor_id").eq("id", id).single();
  if (!pp) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const { data: prov } = await supabase.from("proveedores").select("id").eq("id", pp.proveedor_id).eq("store_id", store_id).single();
  if (!prov) return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });

  const { error } = await supabase.from("proveedor_productos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
