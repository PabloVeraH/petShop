import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET() {
  const { userId, sessionClaims } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meta = sessionClaims?.publicMetadata as Record<string, boolean> | undefined;
  if (!meta?.systemAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = createServiceClient();

  const { data: stores, error } = await supabase
    .from("stores")
    .select("id, name, rut, email, phone, created_at, whatsapp_enabled")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Count users per store
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
