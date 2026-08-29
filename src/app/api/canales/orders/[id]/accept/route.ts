import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { aceptarOrdenExterna } from "@/lib/canales/hub";
import { getRequestMetadata, withErrorLogging } from "@/lib/audit";

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId, userId } = ctx;

  const ordenId = req.nextUrl.pathname.split("/orders/")[1]?.split("/")[0];
  if (!ordenId) {
    return NextResponse.json({ error: "ID de orden requerido" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { ipAddress, userAgent } = await getRequestMetadata(req);

  const result = await aceptarOrdenExterna(ordenId, storeId, userId, supabase, {
    ipAddress,
    userAgent,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    status: "accepted",
    ventaId: result.ventaId,
    total: result.total,
  });
}, { endpoint: "POST /api/canales/orders/id/accept" });
