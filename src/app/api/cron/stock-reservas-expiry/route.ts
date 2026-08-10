import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";

const CRON_SECRET = process.env.CRON_SECRET;
const RESERVATION_TTL_MINUTES = 10;

export const POST = withErrorLogging(async (req: NextRequest) => {
  const secret = req.headers.get("Authorization")?.replace("Bearer ", "");

  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const expiredTime = new Date(Date.now() - RESERVATION_TTL_MINUTES * 60 * 1000).toISOString();

  const { data: expiredReservations, error: selectError } = await supabase
    .from("stock_reservas")
    .select("id, canal_orden_id, items")
    .lt("created_at", expiredTime)
    .eq("estado", "pendiente");

  if (selectError) {
    console.error("[cron] Error fetching expired reservations:", selectError.message);
    return NextResponse.json({ error: "Error fetching expired reservations" }, { status: 500 });
  }

  const reservationIds = (expiredReservations ?? []).map((r) => r.id);

  if (reservationIds.length === 0) {
    return NextResponse.json({ ok: true, expired: 0 });
  }

  // Mark expired reservations as expired
  const { error: updateError } = await supabase
    .from("stock_reservas")
    .update({ estado: "expirada" })
    .in("id", reservationIds);

  if (updateError) {
    console.error("[cron] Error marking reservations as expired:", updateError.message);
    return NextResponse.json({ error: "Error updating reservations" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, expired: reservationIds.length });
}, { endpoint: "POST /api/cron/stock-reservas-expiry" });
