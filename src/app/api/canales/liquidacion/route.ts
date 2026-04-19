import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { z } from "zod";

const liquidacionSchema = z.object({
  canal_id: z.enum(["rappi", "pedidosya", "ubereats"]),
  periodo_inicio: z.string(),
  periodo_fin: z.string(),
  total_ventas: z.number(),
  comision: z.number(),
  neto: z.number(),
});

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId } = ctx;

  const canalId = req.nextUrl.searchParams.get("canal");
  const periodo = req.nextUrl.searchParams.get("periodo");

  const supabase = createServiceClient();

  let query = supabase
    .from("canal_liquidaciones")
    .select("*")
    .eq("store_id", storeId);

  if (canalId) {
    query = query.eq("canal_id", canalId);
  }

  if (periodo) {
    query = query.eq("periodo", periodo);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Error obtieniendo liquidaciones" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId, userId } = ctx;

  const body = await req.json();
  const parsed = liquidacionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { canal_id, periodo_inicio, periodo_fin, total_ventas, comision, neto } = parsed.data;

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("canal_liquidaciones")
    .insert({
      store_id: storeId,
      canal_id,
      periodo_inicio,
      periodo_fin,
      total_ventas,
      comision,
      monto_neto: neto,
      estado: "pendiente",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Error creando liquidación" }, { status: 500 });
  }

  await logAudit({
    storeId,
    userId,
    action: "CREATE",
    entityType: "canal_liquidaciones",
    entityId: data.id,
    changeDescription: `Liquidación ${canal_id} período ${periodo_inicio} al ${periodo_fin}`,
    ipAddress: (await getRequestMetadata(req)).ipAddress,
    userAgent: (await getRequestMetadata(req)).userAgent,
    result: "success",
  });

  return NextResponse.json(
    { id: data.id, estado: data.estado },
    { status: 201 }
  );
}