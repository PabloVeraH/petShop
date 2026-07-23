import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus, resolveAdminContext } from "@/lib/admin-check";
import { ErrorLogsQuerySchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const { sessionClaims, userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let admin = getAdminStatus(sessionClaims);
  if (!admin?.isSystemAdmin && !admin?.isStoreAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Cross-verify systemAdmin claim against DB (stale JWT check)
  admin = await resolveAdminContext(admin) ?? admin;

  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = ErrorLogsQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { store_id, severity, resolved, endpoint, desde, hasta, offset, limit } = parsed.data;
  const effectiveStoreId = admin.isSystemAdmin ? store_id : admin.storeId;

  const supabase = createServiceClient();
  let query = supabase.from("error_logs").select("*", { count: "exact" });

  if (effectiveStoreId) query = query.eq("store_id", effectiveStoreId);
  if (severity) query = query.eq("severity", severity);
  if (resolved !== undefined) query = query.eq("resolved", resolved === "true");
  if (endpoint) query = query.eq("endpoint", endpoint);
  if (desde) query = query.gte("created_at", desde);
  if (hasta) query = query.lte("created_at", hasta);

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)
    .throwOnError();

  if (error) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  return NextResponse.json({
    data: data ?? [],
    count: count ?? 0,
    offset,
    limit,
  });
}
