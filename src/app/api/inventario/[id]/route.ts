import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: user } = await supabase
    .from("clerk_users")
    .select("store_id")
    .eq("clerk_id", userId)
    .single();
  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

  const { tipo, cantidad, notas } = await req.json();

  if (!["entrada", "salida"].includes(tipo)) {
    return NextResponse.json({ error: "tipo debe ser entrada o salida" }, { status: 400 });
  }
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    return NextResponse.json({ error: "cantidad debe ser un entero positivo" }, { status: 400 });
  }

  const { data: prod } = await supabase
    .from("productos")
    .select("id, stock")
    .eq("id", id)
    .eq("store_id", user.store_id)
    .single();

  if (!prod) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const delta = tipo === "entrada" ? cantidad : -cantidad;
  const nuevoStock = Math.max(0, prod.stock + delta);

  const { data: updated, error } = await supabase
    .from("productos")
    .update({ stock: nuevoStock })
    .eq("id", id)
    .select("id, nombre, stock")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("stock_movements").insert({
    producto_id: id,
    tipo,
    cantidad: delta,
    notas: notas ?? `Ajuste manual ${tipo}`,
  });

  return NextResponse.json(updated);
}
