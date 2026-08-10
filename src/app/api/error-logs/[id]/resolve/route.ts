import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus, resolveAdminContext } from "@/lib/admin-check";
import { withErrorLogging } from "@/lib/audit";

export const PATCH = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const { sessionClaims, userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let admin = getAdminStatus(sessionClaims);
  if (!admin?.isSystemAdmin && !admin?.isStoreAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Cross-verify systemAdmin claim against DB (stale JWT check)
  admin = await resolveAdminContext(admin) ?? admin;

  const { id } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("error_logs")
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}, { endpoint: "PATCH /api/error-logs/id/resolve" });
