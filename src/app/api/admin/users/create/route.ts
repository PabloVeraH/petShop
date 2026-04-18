import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus, requireSystemAdmin } from "@/lib/admin-check";

export async function POST(req: NextRequest) {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  
  try {
    requireSystemAdmin(admin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, password, firstName, lastName, storeId, role } = await req.json();

  if (!email || !password || !firstName || !lastName || !role) {
    return NextResponse.json({ error: "Parámetros requeridos: email, password, firstName, lastName, role" }, { status: 400 });
  }

  if (!["storeAdmin", "storeWorker", "systemAdmin"].includes(role)) {
    return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
  }

  if (role !== "systemAdmin" && !storeId) {
    return NextResponse.json({ error: "storeId requerido para roles de tienda" }, { status: 400 });
  }

  try {
    const client = await clerkClient();

    // Create user in Clerk
    const newUser = await client.users.createUser({
      emailAddress: [email],
      password,
      firstName,
      lastName,
    });

    // Update metadata based on role
    if (role === "systemAdmin") {
      await client.users.updateUserMetadata(newUser.id, {
        publicMetadata: {
          systemAdmin: true,
        },
      });

      // Upsert in Supabase
      const supabase = createServiceClient();
      await supabase.from("clerk_users").upsert(
        {
          clerk_id: newUser.id,
          email,
          system_admin: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "clerk_id" }
      );
    } else {
      // storeAdmin or storeWorker
      await client.users.updateUserMetadata(newUser.id, {
        publicMetadata: {
          storeId,
          storeAdmin: role === "storeAdmin",
          storeWorker: role === "storeWorker",
        },
      });

      // Upsert in Supabase
      const supabase = createServiceClient();
      await supabase.from("clerk_users").upsert(
        {
          clerk_id: newUser.id,
          email,
          store_id: storeId,
          store_admin: role === "storeAdmin",
          store_worker: role === "storeWorker",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "clerk_id" }
      );
    }

    return NextResponse.json({ ok: true, clerkId: newUser.id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
