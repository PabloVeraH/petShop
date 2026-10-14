import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { UserDisableSchema } from "@/lib/validation";
import { logAudit, withErrorLogging } from "@/lib/audit";
import { getAdminStatus, requireSystemAdminConsistent } from "@/lib/admin-check";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);

  try {
    await requireSystemAdminConsistent(admin);
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
}, { endpoint: "GET /api/admin/license/users" });

export const POST = withErrorLogging(async (req: NextRequest) => {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);

  try {
    await requireSystemAdminConsistent(admin);
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

  // Cada usuario se procesa por separado: si Clerk falla con uno a mitad del
  // lote, los que ya se banearon/desbanearon igual quedan reflejados en
  // clerk_users.is_disabled (antes el loop abortaba y la BD no se tocaba).
  const exitosos: string[] = [];
  const fallidos: string[] = [];
  for (const userId of userIds) {
    try {
      if (action === "disable") {
        await client.users.banUser(userId);
      } else {
        await client.users.unbanUser(userId);
      }
      exitosos.push(userId);
    } catch {
      fallidos.push(userId);
    }
  }

  let errorBd = false;
  if (exitosos.length > 0) {
    const { error } = await supabase
      .from("clerk_users")
      .update({ is_disabled: action === "disable" })
      .in("clerk_id", exitosos);
    errorBd = !!error;
  }

  const ok = fallidos.length === 0 && !errorBd;
  await logAudit({
    storeId: admin!.storeId,
    userId: admin!.userId,
    action: action === "disable" ? "BAN_USER" : "UNBAN_USER",
    entityType: "license",
    entityId: admin!.storeId,
    oldValues: undefined,
    newValues: { userIds: exitosos, fallidos, action } as Record<string, unknown>,
    changeDescription: `Usuarios ${action === "disable" ? "deshabilitados" : "habilitados"} por systemAdmin: ${exitosos.join(", ") || "ninguno"}${fallidos.length ? `; fallaron en Clerk: ${fallidos.join(", ")}` : ""}${errorBd ? "; no se pudo actualizar clerk_users" : ""}`,
    result: ok ? "success" : exitosos.length > 0 ? "partial" : "failure",
    errorMessage: ok ? undefined : "Error al actualizar usuarios en Clerk o en la BD",
  });

  if (!ok) {
    return NextResponse.json(
      {
        error: errorBd
          ? "Clerk se actualizó pero no se pudo guardar el estado en la base de datos. Reintenta."
          : `No se pudo actualizar ${fallidos.length} de ${userIds.length} usuario(s) en Clerk. Reintenta.`,
        actualizados: exitosos,
        fallidos,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}, { endpoint: "POST /api/admin/license/users" });