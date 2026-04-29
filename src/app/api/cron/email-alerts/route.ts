import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { createServiceClient } = await import("@/lib/supabase");
  const supabase = createServiceClient();

  const { data: stores } = await supabase
    .from("stores")
    .select("id")
    .eq("email_reminder_enabled", true);

  if (!stores || stores.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const { sendEmailAlertsForStore } = await import("@/lib/email-alerts");

  let totalSent = 0;
  for (const store of stores) {
    const { sent } = await sendEmailAlertsForStore(store.id);
    totalSent += sent;
  }

  return NextResponse.json({ processed: stores.length, sent: totalSent });
}