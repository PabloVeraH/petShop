import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";
import { cronAutorizado } from "@/lib/cron-auth";

export const POST = withErrorLogging(async (req: NextRequest) => {
  // Bearer $CRON_SECRET en tiempo constante; sin CRON_SECRET rechaza todo.
  if (!cronAutorizado(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.rpc("clean_old_audit_logs");

  if (error) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}, { endpoint: "POST /api/cron/audit-cleanup" });
