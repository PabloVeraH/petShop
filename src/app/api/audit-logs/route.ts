import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus } from "@/lib/admin-check";
import { AuditLogsQuerySchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const { sessionClaims, userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminStatus(sessionClaims);
  if (!admin?.isSystemAdmin && !admin?.isStoreAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = AuditLogsQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { store_id, user_id, action, entity_type, result, desde, hasta, offset, limit } = parsed.data;
  const effectiveStoreId = admin.isSystemAdmin ? store_id : admin.storeId;

  const supabase = createServiceClient();
  let query = supabase
    .from("audit_logs")
    .select(
      "id, store_id, user_id, action, entity_type, entity_id, old_values, new_values, change_description, ip_address, user_agent, result, error_message, created_at",
      { count: "exact" }
    );

  if (effectiveStoreId) query = query.eq("store_id", effectiveStoreId);
  if (user_id) query = query.eq("user_id", user_id);
  if (action) query = query.eq("action", action);
  if (entity_type) query = query.eq("entity_type", entity_type);
  if (result) query = query.eq("result", result);
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
