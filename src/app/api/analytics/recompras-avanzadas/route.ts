import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { getReorderSuggestions } from "@/lib/analytics/reorder-suggestions";

export async function GET(_req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sugerencias = await getReorderSuggestions(ctx.storeId);
  return NextResponse.json({ sugerencias });
}