import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { MermaLoteSchema, UUIDSchema } from "@/lib/validation";
import { mapearErrorStock } from "@/lib/stock-errors";
import type { MermaLoteResultado } from "@/types";

// D23 — Merma por vencimiento: da de baja un lote vencido (activo=false,
// nunca DELETE: venta_item_lotes conserva la trazabilidad) y registra
// stock_movements 'merma' con el usuario. Solo storeAdmin/systemAdmin,
// validado aquí. La BD rechaza lotes no vencidos o ya dados de baja.
export const POST = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId, userId } = ctx;

  const { sessionClaims } = await auth();
  try {
    requireStoreAdmin(getAdminStatus(sessionClaims), storeId);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!UUIDSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = MermaLoteSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("merma_lote_vencido", {
    p_store_id: storeId,
    p_lote_id:  id,
    p_motivo:   parsed.data.motivo ?? null,
    p_user_id:  userId,
  });

  if (error) {
    const mapped = mapearErrorStock(error.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const { lote, cantidad_baja } = data as MermaLoteResultado;

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId,
    userId,
    action: "UPDATE",
    entityType: "lote_producto",
    entityId: id,
    newValues: { ...lote },
    changeDescription: `Merma por vencimiento: lote "${lote.numero_lote ?? id}" dado de baja (${cantidad_baja} unidades)`,
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

  return NextResponse.json({ lote, cantidad_baja });
}, { endpoint: "POST /api/lotes/id/merma" });
