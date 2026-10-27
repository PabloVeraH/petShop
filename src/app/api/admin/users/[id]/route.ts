import { NextRequest, NextResponse, after } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus, requireStoreAdmin, requireSystemAdminConsistent } from "@/lib/admin-check";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";

// Auditoría de usuarios: el id de Clerk ("user_…") no es uuid y
// audit_logs.entity_id sí lo es (la fila entera se rechazaba): va en
// old_values/new_values como clerk_id, nunca en entity_id. store_id es
// obligatorio: la tienda del usuario afectado o, si no tiene, la del admin.
function mensajeClerk(err: unknown): string | null {
  return isClerkAPIResponseError(err) ? (err.errors[0]?.longMessage ?? err.errors[0]?.message ?? null) : null;
}

const PatchUserSchema = z.object({
  role:   z.enum(["storeWorker", "storeAdmin", "systemAdmin"]),
  nombre: z.string().min(1).max(100).optional(),
  email:  z.string().email().optional(),
});

const PatchUserStoreAdminSchema = z.object({
  role:   z.enum(["storeWorker", "storeAdmin"]),
  nombre: z.string().min(1).max(100).optional(),
  email:  z.string().email().optional(),
});

export const PATCH = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  const { id: clerkId } = await params;

  // storeAdmin — solo editar usuarios de su propia tienda y no puede promover a systemAdmin
  if (admin?.isStoreAdmin && !admin.isSystemAdmin) {
    try {
      requireStoreAdmin(admin);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = createServiceClient();
    const { data: targetUser } = await supabase
      .from("clerk_users")
      .select("store_id")
      .eq("clerk_id", clerkId)
      .single();

    if (!admin.storeId) {
      return NextResponse.json({ error: "Tienda no asignada" }, { status: 403 });
    }
    if (!targetUser || targetUser.store_id !== admin.storeId) {
      return NextResponse.json({ error: "Usuario no pertenece a tu tienda" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = PatchUserStoreAdminSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { role, nombre, email } = parsed.data;
    return handlePatchUser(clerkId, admin.storeId, admin.userId, role, nombre, email, req);
  }

  try {
    await requireSystemAdminConsistent(admin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = PatchUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { role, nombre, email } = parsed.data;
  return handlePatchUser(clerkId, admin!.storeId, admin!.userId, role, nombre, email, req);
}, { endpoint: "PATCH /api/admin/users/id" });

async function handlePatchUser(
  clerkId: string,
  storeId: string,
  userId: string,
  role: string,
  nombre: string | undefined,
  email: string | undefined,
  req: NextRequest,
) {
  const flags = {
    system_admin: role === "systemAdmin",
    store_admin:  role === "storeAdmin",
    store_worker: role === "storeWorker",
  };

  const supabase = createServiceClient();
  const { data: oldUser } = await supabase
    .from("clerk_users")
    .select("email, nombre, store_admin, store_worker, system_admin, store_id")
    .eq("clerk_id", clerkId)
    .single();

  // Un rol de tienda (storeAdmin/storeWorker) necesita un storeId. Este endpoint
  // no recibe uno en el body — se preserva el store_id que el usuario ya tenía
  // en clerk_users. Si no tiene uno (ej. systemAdmin creado sin tienda vía
  // /api/admin/users/create), no hay tienda válida que asignarle: mejor fallar
  // explícito que dejar un storeAdmin/storeWorker sin tienda (getStoreId()
  // le devolvería null y quedaría inutilizable).
  const targetStoreId: string | null = oldUser?.store_id ?? null;
  if (role !== "systemAdmin" && !targetStoreId) {
    return NextResponse.json(
      { error: "El usuario no tiene una tienda asignada; no se le puede otorgar un rol de tienda" },
      { status: 400 }
    );
  }

  const client = await clerkClient();

  // Validate email uniqueness before making any change
  if (email && email !== oldUser?.email) {
    const existing = await client.users.getUserList({ emailAddress: [email] });
    const conflict = existing.data.find((u) => u.id !== clerkId);
    if (conflict) {
      return NextResponse.json(
        { error: `El email ${email} ya está en uso por otro usuario` },
        { status: 409 }
      );
    }
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  const auditoria = {
    storeId: targetStoreId ?? storeId,
    userId,
    action: "UPDATE" as const,
    entityType: "usuario",
    oldValues: oldUser ? { clerk_id: clerkId, ...oldUser } : { clerk_id: clerkId },
    ipAddress,
    userAgent,
  };

  try {
    // Sincronizar el rol con Clerk publicMetadata — sin esto, el JWT del usuario
    // conserva su rol anterior para siempre (clerk_users es solo un espejo interno,
    // no la fuente de autorización real; ticket Trello 6a61a8b2792efeb5e59de96a).
    // Se envía el objeto completo (systemAdmin/storeAdmin/storeWorker/storeId)
    // en vez de solo las claves que cambian, para no depender de si Clerk
    // mergea o reemplaza publicMetadata — así el resultado es correcto en ambos casos.
    await client.users.updateUserMetadata(clerkId, {
      publicMetadata:
        role === "systemAdmin"
          ? { systemAdmin: true, storeAdmin: false, storeWorker: false, storeId: null }
          : {
              systemAdmin: false,
              storeAdmin: role === "storeAdmin",
              storeWorker: role === "storeWorker",
              storeId: targetStoreId,
            },
    });

    // Add new email address as primary and verified (después de sincronizar el
    // rol: si esto falla, el rol en Clerk ya quedó correcto — no hay reversión
    // automática, mismo patrón sin rollback que ya tenía esta función).
    if (email && email !== oldUser?.email) {
      await client.emailAddresses.createEmailAddress({
        userId:       clerkId,
        emailAddress: email,
        primary:      true,
        verified:     true,
      });
    }

    // Update name in Clerk if provided
    if (nombre) {
      const parts = nombre.trim().split(/\s+/);
      const firstName = parts[0];
      const lastName  = parts.slice(1).join(" ") || " ";
      await client.users.updateUser(clerkId, { firstName, lastName });
    }
  } catch (err: unknown) {
    // Clerk rechazó el cambio (ej. email inválido): queda el intento en
    // auditoría. Puede haber quedado aplicado en parte (mismo orden sin
    // rollback de siempre: rol → email → nombre).
    const mensaje = mensajeClerk(err);
    await logAudit({
      ...auditoria,
      changeDescription: `Editar usuario ${oldUser?.email ?? clerkId} falló en Clerk`,
      result: "failure",
      errorMessage: mensaje ?? (err instanceof Error ? err.message : String(err)),
    });
    if (mensaje) return NextResponse.json({ error: mensaje }, { status: 422 });
    throw err;
  }

  const updates: Record<string, unknown> = { ...flags };
  if (role !== "systemAdmin") updates.store_id = targetStoreId;
  if (nombre) updates.nombre = nombre.trim();
  if (email && email !== oldUser?.email) updates.email = email;

  const { error } = await supabase
    .from("clerk_users")
    .update(updates)
    .eq("clerk_id", clerkId);

  if (error) {
    await logAudit({
      ...auditoria,
      newValues: { clerk_id: clerkId, ...updates },
      changeDescription: `Editar usuario ${oldUser?.email ?? clerkId}: aplicado en Clerk pero falló al guardar en la base`,
      result: "failure",
      errorMessage: error.message,
    });
    return NextResponse.json({ error: "Error al actualizar usuario" }, { status: 500 });
  }

  const changes: string[] = [`rol → ${role}`];
  if (nombre) changes.push(`nombre → ${nombre.trim()}`);
  if (email && email !== oldUser?.email) changes.push(`email → ${email}`);
  after(() => logAudit({
    ...auditoria,
    newValues: { clerk_id: clerkId, ...updates },
    changeDescription: `Usuario ${oldUser?.email ?? clerkId}: ${changes.join(", ")}`,
    result: "success",
  }).catch(() => {}));

  return NextResponse.json({ ok: true });
}

export const DELETE = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  
  try {
    await requireSystemAdminConsistent(admin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: clerkId } = await params;
  // Bloquearse a sí mismo dejaría al systemAdmin fuera del sistema.
  if (clerkId === admin!.userId) {
    return NextResponse.json({ error: "No puedes eliminar tu propio usuario" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: userToDelete } = await supabase
    .from("clerk_users")
    .select("clerk_id, email, store_id, store_admin, store_worker, system_admin")
    .eq("clerk_id", clerkId)
    .single();
  if (!userToDelete) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const { ipAddress, userAgent } = getRequestMetadata(req);
  const auditoria = {
    storeId: userToDelete.store_id ?? admin!.storeId,
    userId: admin!.userId,
    action: "DELETE" as const,
    entityType: "usuario",
    oldValues: userToDelete,
    ipAddress,
    userAgent,
  };

  // Borrar solo la fila de clerk_users no quitaba el acceso: el usuario seguía
  // en Clerk con su tienda y rol en el JWT. Se le quitan tienda y roles (si el
  // webhook user.updated recrea la fila, queda sin tienda y fuera de las
  // listas) y se lo bloquea: Clerk revoca sus sesiones y no puede volver a
  // entrar. Reversible desde el Dashboard de Clerk (unban). Si ya no existe en
  // Clerk (404) no hay acceso que quitar y se sigue con el borrado.
  const client = await clerkClient();
  try {
    await client.users.updateUserMetadata(clerkId, {
      publicMetadata: { systemAdmin: false, storeAdmin: false, storeWorker: false, storeId: null },
    });
    await client.users.banUser(clerkId);
  } catch (err: unknown) {
    if (!(isClerkAPIResponseError(err) && err.status === 404)) {
      await logAudit({
        ...auditoria,
        changeDescription: `Eliminar usuario ${userToDelete.email}: no se pudo bloquear en Clerk; no se eliminó`,
        result: "failure",
        errorMessage: mensajeClerk(err) ?? (err instanceof Error ? err.message : String(err)),
      });
      return NextResponse.json({ error: "No se pudo bloquear el usuario; no se eliminó" }, { status: 502 });
    }
  }

  const { error } = await supabase
    .from("clerk_users")
    .delete()
    .eq("clerk_id", clerkId);

  if (error) {
    await logAudit({
      ...auditoria,
      changeDescription: `Eliminar usuario ${userToDelete.email}: bloqueado en Clerk pero falló el borrado en la base`,
      result: "failure",
      errorMessage: error.message,
    });
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  after(() => logAudit({
    ...auditoria,
    changeDescription: `Usuario ${userToDelete.email} eliminado y bloqueado en Clerk`,
  }).catch(() => {}));

  return NextResponse.json({ ok: true });
}, { endpoint: "DELETE /api/admin/users/id" });
