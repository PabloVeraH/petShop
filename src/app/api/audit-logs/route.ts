import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus, resolveAdminContext } from "@/lib/admin-check";
import { AuditLogsQuerySchema } from "@/lib/validation";

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

  const logs = data ?? [];

  // Enrich with user emails from clerk_users
  const userIds = [...new Set(logs.map((l) => l.user_id).filter(Boolean))];
  let emailMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("clerk_users")
      .select("clerk_id, email")
      .in("clerk_id", userIds);
    if (users) {
      emailMap = Object.fromEntries(users.map((u) => [u.clerk_id, u.email]));
    }

    // Fallback: fetch from Clerk API for users not yet in clerk_users and backfill them
    const missingIds = userIds.filter((id) => !emailMap[id]);
    if (missingIds.length > 0) {
      try {
        const client = await clerkClient();
        const { data: clerkUsers } = await client.users.getUserList({ userId: missingIds, limit: missingIds.length });
        const toUpsert: { clerk_id: string; email: string; nombre: string }[] = [];
        for (const cu of clerkUsers) {
          const email = cu.emailAddresses[0]?.emailAddress ?? cu.id;
          const nombre = [cu.firstName, cu.lastName].filter(Boolean).join(" ") || email;
          emailMap[cu.id] = email;
          toUpsert.push({ clerk_id: cu.id, email, nombre });
        }
        if (toUpsert.length > 0) {
          supabase
            .from("clerk_users")
            .upsert(toUpsert, { onConflict: "clerk_id", ignoreDuplicates: false })
            .then(() => {}, () => {});
        }
      } catch {
        // Non-critical: display falls back to user_id if Clerk API is unavailable
      }
    }
  }

  return NextResponse.json({
    data: logs.map((l) => ({ ...l, user_email: emailMap[l.user_id] ?? null })),
    count: count ?? 0,
    offset,
    limit,
  });
}
