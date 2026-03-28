import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
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

  const { data: cliente, error } = await supabase
    .from("clientes")
    .select(`
      id, store_id, rut, nombre, email, telefono,
      mascotas(id, nombre, tipo, raza, peso_kg, alimento_habitual_id)
    `)
    .eq("id", id)
    .eq("store_id", user.store_id)
    .single();

  if (error?.code === "PGRST116") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: ventas } = await supabase
    .from("ventas")
    .select("id, total, metodo_pago, created_at")
    .eq("store_id", user.store_id)
    .eq("cliente_id", id)
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({ ...cliente, ventas: ventas ?? [] });
}
