import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (_req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id, systemAdmin } = ctx;

  const { id } = await params;
  const supabase = createServiceClient();

  let query = supabase
    .from("notas_credito")
    .select("id, numero_nc, monto_total, fecha_vencimiento, estado, tipo_reembolso, created_at")
    .eq("id", id);

  if (!systemAdmin) query = query.eq("store_id", store_id);

  const { data: nc, error } = await query.single();

  if (error || !nc) return NextResponse.json({ error: "NC no encontrada" }, { status: 404 });

  const { data: store } = await supabase
    .from("stores")
    .select("name")
    .eq("id", store_id)
    .single();

  return NextResponse.json({ ...nc, storeName: store?.name ?? "PetShop" });
}, { endpoint: "GET /api/notas-credito/id" });
