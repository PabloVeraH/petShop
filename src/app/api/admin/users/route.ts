import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus, requireSystemAdmin } from "@/lib/admin-check";
import { AdminUserAssignSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata } from "@/lib/audit";

// GET /api/admin/users?storeId=xxx  — lista usuarios de una tienda
// systemAdmin: requiere storeId param; storeAdmin: fuerza su propia storeId
export async function GET(req: NextRequest) {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);

  // storeAdmin — solo puede ver usuarios de su propia tienda
  if (admin?.isStoreAdmin && !admin.isSystemAdmin) {
    if (!admin.storeId) return NextResponse.json({ error: "Tienda no asignada" }, { status: 403 });
    const supabase = createServiceClient();
    const { data: users, error } = await supabase
      .from("clerk_users")
      .select("clerk_id, email, nombre, rut, store_admin, store_worker, system_admin, updated_at")
      .eq("store_id", admin.storeId)
      .order("updated_at", { ascending: false });

    if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    return NextResponse.json(users ?? []);
  }

  try {
    requireSystemAdmin(admin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const storeId = req.nextUrl.searchParams.get("storeId");
  if (!storeId) return NextResponse.json({ error: "storeId requerido" }, { status: 400 });

  const supabase = createServiceClient();
  const { data: users, error } = await supabase
    .from("clerk_users")
    .select("clerk_id, email, nombre, rut, store_admin, store_worker, system_admin, updated_at")
    .eq("store_id", storeId)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(users ?? []);
}

// POST /api/admin/users  — asigna un usuario existente a una tienda con un rol
// Body: { email: string, storeId: string, role: "storeAdmin" | "storeWorker" }
export async function POST(req: NextRequest) {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);

  try {
    requireSystemAdmin(admin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = AdminUserAssignSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { email, storeId, role } = parsed.data;

  const client = await clerkClient();
  const result = await client.users.getUserList({ emailAddress: [email], limit: 1 });
  const target = result.data[0];
  if (!target) return NextResponse.json({ error: "Usuario no encontrado en Clerk" }, { status: 404 });

  // Update Clerk publicMetadata
  await client.users.updateUserMetadata(target.id, {
    publicMetadata: {
      storeId,
      storeAdmin: role === "storeAdmin",
      storeWorker: role === "storeWorker",
    },
  });

  // Sync clerk_users — nombre solo se incluye si Clerk lo tiene (no sobreescribir con null)
  const supabase = createServiceClient();
  const nombre = [target.firstName, target.lastName].filter(Boolean).join(" ") || null;
  await supabase.from("clerk_users").upsert(
    {
      clerk_id: target.id,
      email,
      ...(nombre ? { nombre } : {}),
      store_id: storeId,
      store_admin: role === "storeAdmin",
      store_worker: role === "storeWorker",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clerk_id" }
  );

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId,
    userId: admin!.userId,
    action: "CREATE",
    entityType: "usuario",
    entityId: target.id,
    newValues: { email, role },
    changeDescription: `Usuario ${email} creado con rol ${role}`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json({ ok: true, clerkId: target.id });
}
