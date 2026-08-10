import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { predictDemand } from "@/lib/analytics/demand-forecasting";
import { z } from "zod";
import { withErrorLogging } from "@/lib/audit";

const QuerySchema = z.object({
  producto_id: z.string().uuid(),
  dias: z.coerce.number().int().min(1).max(90).default(30),
});

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = QuerySchema.safeParse({
    producto_id: req.nextUrl.searchParams.get("producto_id"),
    dias: req.nextUrl.searchParams.get("dias") ?? 30,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { producto_id, dias } = parsed.data;
  const prediccion = await predictDemand(producto_id, ctx.storeId, dias);
  return NextResponse.json(prediccion);
}, { endpoint: "GET /api/reports/prediccion" });
