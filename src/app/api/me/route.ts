import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async () => {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users")
    .select("store_id, store_admin, store_worker, system_admin")
    .eq("clerk_id", userId)
    .single();

  if (!user) return NextResponse.json({});

  return NextResponse.json({
    storeId: user.store_id ?? undefined,
    storeAdmin: user.store_admin,
    storeWorker: user.store_worker,
    systemAdmin: user.system_admin,
  });
}, { endpoint: "GET /api/me" });
