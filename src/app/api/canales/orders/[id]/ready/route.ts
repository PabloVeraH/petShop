import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { UUIDSchema } from "@/lib/validation";
import { esCanalExterno } from "@/lib/canales/domain/types";
import { encolarOutbox } from "@/lib/canales/application/outbox";

// "Marcar lista para retiro" (paso 3.8, D8): cualquier usuario de la tienda
// (el storeWorker prepara el pedido). Transición atómica accepted → ready y
// aviso a la plataforma por la outbox (dedupe: doble clic no duplica).
// Tenant: una orden de otra tienda responde 404 sin confirmar que exista.
export const POST = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId, userId } = ctx;

  const { id } = await params;
  if (!UUIDSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("canal_ordenes")
    .update({ estado: "ready", ready_at: new Date().toISOString() })
    .eq("id", id)
    .eq("store_id", storeId)
    .eq("estado", "accepted")
    .select("id, canal_id, external_order_id");
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const orden = data?.[0];
  if (!orden) {
    const { data: existe } = await supabase
      .from("canal_ordenes")
      .select("estado")
      .eq("id", id)
      .eq("store_id", storeId)
      .maybeSingle();
    if (!existe) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    return NextResponse.json(
      { error: existe.estado === "ready" ? "La orden ya está marcada como lista" : "Solo una orden aceptada puede marcarse como lista" },
      { status: 409 }
    );
  }

  if (esCanalExterno(orden.canal_id)) {
    await encolarOutbox(supabase, {
      storeId,
      canalId: orden.canal_id,
      tipo: "ready",
      canalOrdenId: orden.id,
      payload: { external_order_id: orden.external_order_id },
    });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId,
    userId,
    action: "UPDATE",
    entityType: "canal_ordenes",
    entityId: orden.id,
    changeDescription: `Orden ${orden.external_order_id} (${orden.canal_id}) marcada lista para retiro`,
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

  return NextResponse.json({ id: orden.id, estado: "ready" });
}, { endpoint: "POST /api/canales/orders/id/ready" });
