import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { getChannel } from "@/lib/canales/registry";
import { liberarReservaSinDescontar } from "@/lib/canales/hub";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { z } from "zod";
import type { CanalId, CanalConfig } from "@/lib/canales/types";

const rejectSchema = z.object({
  reason: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId, userId } = ctx;

  const ordenId = req.nextUrl.pathname.split("/orders/")[1]?.split("/")[0];

  if (!ordenId) {
    return NextResponse.json({ error: "ID de orden requerido" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = rejectSchema.safeParse(body);
  const reason = parsed.success ? parsed.data.reason : "Rechazado por el operador";

  const supabase = createServiceClient();

  const { data: orden, error: ordenError } = await supabase
    .from("canal_ordenes")
    .select("*")
    .eq("id", ordenId)
    .eq("store_id", storeId)
    .single();

  if (ordenError || !orden) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  if (orden.estado !== "pending" && orden.estado !== "reserved") {
    return NextResponse.json({ error: "La orden ya fue procesada" }, { status: 400 });
  }

  const canalIdTyped = orden.canal_id as CanalId;

  await liberarReservaSinDescontar(ordenId, supabase);

  try {
    const channel = getChannel(canalIdTyped);
    const config: CanalConfig = {
      storeId,
      canalId: canalIdTyped,
      externalStoreId: "",
      credentials: {},
      comisionPct: 0,
    };
    await channel.rejectOrder(config, orden.external_order_id, reason);
  } catch (e) {
    console.error("Error rechazando al canal:", e);
  }

  await supabase
    .from("canal_ordenes")
    .update({
      estado: "rejected",
      rejected_at: new Date().toISOString(),
      motivo_rechazo: reason,
    })
    .eq("id", ordenId);

  await logAudit({
    storeId,
    userId,
    action: "REJECT",
    entityType: "canal_ordenes",
    entityId: ordenId,
    changeDescription: `Orden ${orden.external_order_id} rechazada: ${reason}`,
    ipAddress: (await getRequestMetadata(req)).ipAddress,
    userAgent: (await getRequestMetadata(req)).userAgent,
    result: "success",
  });

  return NextResponse.json({
    status: "rejected",
    reason,
  });
}