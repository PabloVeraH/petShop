import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus, requireStoreAdmin, requireSystemAdminConsistent } from "@/lib/admin-check";

export async function GET() {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);

  const supabase = createServiceClient();

  // systemAdmin → all stores; storeAdmin → their own store only
  // Cross-verify against DB to catch stale JWTs
  if (admin?.isSystemAdmin) {
    try {
      await requireSystemAdminConsistent(admin);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (admin?.isSystemAdmin) {
    const { data: stores, error } = await supabase
      .from("stores")
      .select("id, name, rut, email, phone, created_at, whatsapp_enabled, openrouter_model")
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

    const { data: userCounts } = await supabase
      .from("clerk_users")
      .select("store_id");

    const countMap: Record<string, number> = {};
    for (const u of userCounts ?? []) {
      if (u.store_id) countMap[u.store_id] = (countMap[u.store_id] ?? 0) + 1;
    }

    return NextResponse.json(
      (stores ?? []).map((s) => ({ ...s, user_count: countMap[s.id] ?? 0 }))
    );
  }

  // storeAdmin — only their own store
  try {
    requireStoreAdmin(admin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const storeId = admin!.storeId;
  if (!storeId) return NextResponse.json({ error: "Tienda no asignada" }, { status: 403 });
  const { data: store, error } = await supabase
    .from("stores")
    .select("id, name, rut, email, phone, created_at, whatsapp_enabled, openrouter_model")
    .eq("id", storeId)
    .single();

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const { data: userCounts } = await supabase
    .from("clerk_users")
    .select("store_id")
    .eq("store_id", storeId);

  return NextResponse.json([{ ...store, user_count: userCounts?.length ?? 0 }]);
}
