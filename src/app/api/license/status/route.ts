import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { computeLicenseStatus } from "@/lib/license";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const { sessionClaims } = await auth();
  const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
  const storeId = meta?.storeId as string | undefined;
  const isSystemAdmin = Boolean(meta?.systemAdmin);

  if (!storeId) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  if (isSystemAdmin) {
    return NextResponse.json({
      status: { isAutoBlocked: false, isInWarningPeriod: false, daysUntilExpiry: null, licenseEndDate: null },
    });
  }

  const supabase = createServiceClient();
  const { data: store } = await supabase
    .from("stores")
    .select("license_end_date, license_warning_days")
    .eq("id", storeId)
    .single();

  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const status = computeLicenseStatus({
    license_end_date: store.license_end_date,
    license_warning_days: store.license_warning_days,
  });

  return NextResponse.json({ status });
}, { endpoint: "GET /api/license/status" });