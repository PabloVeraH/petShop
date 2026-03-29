import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { proveedor_id, producto_id, costo, tiempo_entrega_dias } = await req.json();
  if (!proveedor_id || !producto_id) return NextResponse.json({ error: "Faltan campos" }, { status: 400 });

  const supabase = createServiceClient();
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
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase.from("proveedor_productos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
