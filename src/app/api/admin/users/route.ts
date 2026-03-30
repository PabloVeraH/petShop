import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";

// GET /api/admin/users?storeId=xxx  — lista usuarios de una tienda
export async function GET(req: NextRequest) {
  const { userId, sessionClaims } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
  if (!meta?.systemAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const storeId = req.nextUrl.searchParams.get("storeId");
  if (!storeId) return NextResponse.json({ error: "storeId requerido" }, { status: 400 });

  const supabase = createServiceClient();
  const { data: users, error } = await supabase
    .from("clerk_users")
    .select("clerk_id, email, store_admin, store_worker, system_admin, updated_at")
    .eq("store_id", storeId)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(users ?? []);
}

// POST /api/admin/users  — asigna un usuario existente a una tienda con un rol
// Body: { email: string, storeId: string, role: "storeAdmin" | "storeWorker" }
export async function POST(req: NextRequest) {
  const { userId, sessionClaims } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
  if (!meta?.systemAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { email, storeId, role } = await req.json();
  if (!email || !storeId || !["storeAdmin", "storeWorker"].includes(role)) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

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

  // Sync clerk_users
  const supabase = createServiceClient();
  await supabase.from("clerk_users").upsert(
    {
      clerk_id: target.id,
      email,
      store_id: storeId,
      store_admin: role === "storeAdmin",
      store_worker: role === "storeWorker",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clerk_id" }
  );

  return NextResponse.json({ ok: true, clerkId: target.id });
}
