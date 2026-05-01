import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { UserDisableSchema } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { getAdminStatus, requireSystemAdmin } from "@/lib/admin-check";

export async function GET(req: NextRequest) {
  const { userId: adminId, sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);

  try {
    requireSystemAdmin(admin);
  } catch {
    return NextResponse.json({ error: "System admin required" }, { status: 403 });
  }

  const supabase = createServiceClient();
  const { data: users } = await supabase
    .from("clerk_users")
    .select("clerk_id, email, system_admin, store_admin, store_worker, is_disabled")
    .eq("store_id", admin!.storeId)
    .eq("system_admin", false);

  return NextResponse.json(users ?? []);
}

export async function POST(req: NextRequest) {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);

  try {
    requireSystemAdmin(admin);
  } catch {
    return NextResponse.json({ error: "System admin required" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = UserDisableSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const { userIds, action } = parsed.data;

  if (userIds.includes(admin!.userId)) {
    return NextResponse.json({ error: "No puedes deshabilitarte a ti mismo" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const client = await clerkClient();

  try {
    for (const userId of userIds) {
      if (action === "disable") {
        await client.users.banUser(userId);
      } else {
        await client.users.unbanUser(userId);
      }
    }
  } catch (err) {
    return NextResponse.json({ error: "Error al actualizar usuario en Clerk" }, { status: 500 });
  }

  const supabaseAction = action === "disable" ? true : false;
  await supabase
    .from("clerk_users")
    .update({ is_disabled: supabaseAction })
    .in("clerk_id", userIds);

  await logAudit({
    storeId: admin!.storeId,
    userId: admin!.userId,
    action: action === "disable" ? "BAN_USER" : "UNBAN_USER",
    entityType: "license",
    entityId: admin!.storeId,
    oldValues: undefined,
    newValues: { userIds, action } as Record<string, unknown>,
    changeDescription: `Usuarios ${action === "disable" ? "deshabilitados" : "habilitados"} por systemAdmin: ${userIds.join(", ")}`,
    result: "success",
  });

  return NextResponse.json({ success: true });
}