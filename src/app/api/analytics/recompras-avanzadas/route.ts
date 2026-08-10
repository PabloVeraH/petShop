import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { getReorderSuggestions } from "@/lib/analytics/reorder-suggestions";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (_req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sugerencias = await getReorderSuggestions(ctx.storeId);
  return NextResponse.json({ sugerencias });
}, { endpoint: "GET /api/analytics/recompras-avanzadas" });