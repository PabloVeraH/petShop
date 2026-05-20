import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus } from "@/lib/admin-check";

export async function GET(req: NextRequest) {
  const { sessionClaims, userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminStatus(sessionClaims);
  if (!admin?.isSystemAdmin && !admin?.isStoreAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();
  const storeId = admin.isSystemAdmin ? undefined : admin.storeId;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  let auditQuery = supabase.from("audit_logs").select("action, user_id, result, created_at");
  if (storeId) auditQuery = auditQuery.eq("store_id", storeId);
  auditQuery = auditQuery.gte("created_at", thirtyDaysAgo);
  const { data: auditLogs, error: auditError } = await auditQuery;

  if (auditError) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const logs = auditLogs ?? [];
  const total_last_30_days = logs.length;

  const actionCounts: Record<string, number> = {};
  const userCounts: Record<string, number> = {};
  let failures_last_7_days = 0;

  for (const log of logs) {
    actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
    userCounts[log.user_id] = (userCounts[log.user_id] || 0) + 1;
    if (log.result === "failure" && new Date(log.created_at) >= new Date(sevenDaysAgo)) {
      failures_last_7_days++;
    }
  }

  const by_action = Object.entries(actionCounts)
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const by_user = Object.entries(userCounts)
    .map(([user_id, count]) => ({ user_id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  let errorQuery = supabase.from("error_logs").select("id");
  if (storeId) errorQuery = errorQuery.eq("store_id", storeId);
  errorQuery = errorQuery.eq("severity", "CRITICAL").gte("created_at", twentyFourHoursAgo);
  const { data: criticalErrors, error: errorError } = await errorQuery;

  const critical_errors_last_24h = criticalErrors?.length ?? 0;

  return NextResponse.json({
    total_last_30_days,
    by_action,
    by_user,
    failures_last_7_days,
    critical_errors_last_24h,
  });
}
