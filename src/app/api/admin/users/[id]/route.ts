import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus, requireStoreAdmin, requireSystemAdminConsistent } from "@/lib/admin-check";
import { logAudit, getRequestMetadata } from "@/lib/audit";

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
}

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
    .select("email, nombre, store_admin, store_worker, system_admin")
    .eq("clerk_id", clerkId)
    .single();

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
    // Add new email address as primary and verified
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

  const updates: Record<string, unknown> = { ...flags };
  if (nombre) updates.nombre = nombre.trim();
  if (email && email !== oldUser?.email) updates.email = email;

  const { error } = await supabase
    .from("clerk_users")
    .update(updates)
    .eq("clerk_id", clerkId);

  if (error) return NextResponse.json({ error: "Error al actualizar usuario" }, { status: 500 });

  const { ipAddress, userAgent } = getRequestMetadata(req);
  const changes: string[] = [`rol → ${role}`];
  if (nombre) changes.push(`nombre → ${nombre.trim()}`);
  if (email && email !== oldUser?.email) changes.push(`email → ${email}`);
  logAudit({
    storeId,
    userId,
    action:  "UPDATE",
    entityType: "usuario",
    entityId:   clerkId,
    oldValues:  oldUser ?? undefined,
    newValues:  updates,
    changeDescription: `Usuario ${oldUser?.email ?? clerkId}: ${changes.join(", ")}`,
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  
  try {
    await requireSystemAdminConsistent(admin);
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
