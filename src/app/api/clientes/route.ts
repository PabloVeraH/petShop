import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users")
    .select("store_id")
    .eq("clerk_id", userId)
    .single();

  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

  const rut = req.nextUrl.searchParams.get("rut");
  if (!rut) return NextResponse.json({ error: "rut required" }, { status: 400 });

  const { data, error } = await supabase
    .from("clientes")
    .select("id, store_id, rut, nombre, email, telefono")
    .eq("store_id", user.store_id)
    .eq("rut", rut)
    .single();

  if (error?.code === "PGRST116") return NextResponse.json(null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
