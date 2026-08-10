import { NextResponse } from "next/server";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async () => {
  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
}, { endpoint: "GET /api/health" });
