import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus, requireSystemAdmin } from "@/lib/admin-check";
import { logAudit, getRequestMetadata } from "@/lib/audit";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  
  try {
    requireSystemAdmin(admin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: clerkId } = await params;

  try {
    const supabase = createServiceClient();
    const { data: userToDelete } = await supabase
      .from("clerk_users")
      .select("clerk_id, email, store_id, store_admin, store_worker")
      .eq("clerk_id", clerkId)
      .single();

    const { error } = await supabase
      .from("clerk_users")
      .delete()
      .eq("clerk_id", clerkId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { ipAddress, userAgent } = getRequestMetadata(req);
    logAudit({
      storeId: admin!.storeId,
      userId: admin!.userId,
      action: "DELETE",
      entityType: "usuario",
      entityId: clerkId,
      oldValues: userToDelete ?? undefined,
      changeDescription: `Usuario ${userToDelete?.email ?? clerkId} eliminado`,
      ipAddress,
      userAgent,
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
