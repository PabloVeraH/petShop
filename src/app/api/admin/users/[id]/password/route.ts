import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus, requireSystemAdminConsistent } from "@/lib/admin-check";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import { AdminUserPasswordSchema } from "@/lib/validation";

type ClerkApiError = { errors: { code?: string; longMessage?: string; message?: string }[] };

function isClerkApiError(err: unknown): err is ClerkApiError {
  return err !== null && typeof err === "object" && "errors" in err && Array.isArray((err as ClerkApiError).errors);
}

// Cambio de contraseña de un usuario: SOLO systemAdmin, confirmado contra la
// BD (un JWT viejo con systemAdmin no basta). La contraseña nunca se guarda
// ni se registra: va directo a Clerk. El usuario queda deslogueado de todas
// sus sesiones activas.
export const POST = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  try {
    await requireSystemAdminConsistent(admin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: clerkId } = await params;
  const parsed = AdminUserPasswordSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: target } = await supabase
    .from("clerk_users")
    .select("email, store_id")
    .eq("clerk_id", clerkId)
    .single();
  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const { ipAddress, userAgent } = getRequestMetadata(req);
  // audit_logs.store_id es obligatorio: la tienda del usuario afectado o, si
  // no tiene (otro systemAdmin), la del admin. entity_id es uuid y el id de
  // Clerk no lo es: va en new_values.
  const auditoria = {
    storeId: target.store_id ?? admin!.storeId,
    userId: admin!.userId,
    action: "UPDATE" as const,
    entityType: "usuario",
    newValues: { clerk_id: clerkId },
    ipAddress,
    userAgent,
  };

  const client = await clerkClient();
  try {
    await client.users.updateUser(clerkId, { password: parsed.data.password, signOutOfOtherSessions: true });
  } catch (error: unknown) {
    if (isClerkApiError(error) && error.errors.length > 0) {
      // Mensaje ya redactado por Clerk para el usuario final (ej. contraseña
      // filtrada o muy corta).
      const message = error.errors[0].longMessage ?? error.errors[0].message ?? "No se pudo cambiar la contraseña";
      await logAudit({ ...auditoria, changeDescription: `Cambio de contraseña de ${target.email} rechazado`, result: "failure", errorMessage: message });
      return NextResponse.json({ error: message }, { status: 422 });
    }
    throw error;
  }

  await logAudit({ ...auditoria, changeDescription: `Contraseña de ${target.email} cambiada` });
  return NextResponse.json({ ok: true });
}, { endpoint: "POST /api/admin/users/id/password" });
