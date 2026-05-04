import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clerkId: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId } = ctx;
  const { clerkId } = await params;

  const desde = req.nextUrl.searchParams.get("desde");
  const hasta = req.nextUrl.searchParams.get("hasta");

  const supabase = createServiceClient();
  let query = supabase
    .from("ventas")
    .select("id, numero_comprobante, total, metodo_pago, estado, created_at, clientes(nombre)")
    .eq("store_id", storeId)
    .eq("worker_clerk_id", clerkId)
    .neq("estado", "anulada")
    .order("created_at", { ascending: false });

  if (desde) query = query.gte("created_at", new Date(desde).toISOString());
  if (hasta) {
    const hastaFin = new Date(hasta);
    hastaFin.setHours(23, 59, 59, 999);
    query = query.lte("created_at", hastaFin.toISOString());
  }

  const { data, error } = await query.limit(200);
  if (error) return NextResponse.json({ error: "Error interno" }, { status: 500 });
  return NextResponse.json(data ?? []);
}