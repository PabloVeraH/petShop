import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { LicenseConfigSchema } from "@/lib/validation";
import { logAudit, withErrorLogging } from "@/lib/audit";
import { getAdminStatus, requireSystemAdminConsistent } from "@/lib/admin-check";
import { computeLicenseStatus } from "@/lib/license";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);

  try {
    await requireSystemAdminConsistent(admin);
  } catch {
    return NextResponse.json({ error: "System admin required" }, { status: 403 });
  }

  const supabase = createServiceClient();
  const { data: store } = await supabase
    .from("stores")
    .select("license_start_date, license_end_date, license_warning_days")
    .eq("id", admin!.storeId)
    .single();

  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const status = computeLicenseStatus({
    license_end_date: store.license_end_date,
    license_warning_days: store.license_warning_days,
  });

  return NextResponse.json({
    config: {
      license_start_date: store.license_start_date,
      license_end_date: store.license_end_date,
      license_warning_days: store.license_warning_days,
    },
    status,
  });
}, { endpoint: "GET /api/admin/license" });

export const PATCH = withErrorLogging(async (req: NextRequest) => {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);

  try {
    await requireSystemAdminConsistent(admin);
  } catch {
    return NextResponse.json({ error: "System admin required" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = LicenseConfigSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: currentStore } = await supabase
    .from("stores")
    .select("license_start_date, license_end_date, license_warning_days")
    .eq("id", admin!.storeId)
    .single();

  const { error } = await supabase
    .from("stores")
    .update({
      license_start_date: parsed.data.license_start_date ?? null,
      license_end_date: parsed.data.license_end_date ?? null,
      license_warning_days: parsed.data.license_warning_days ?? 7,
    })
    .eq("id", admin!.storeId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    storeId: admin!.storeId,
    userId: admin!.userId,
    action: "UPDATE",
    entityType: "license",
    entityId: admin!.storeId,
    oldValues: currentStore ?? undefined,
    newValues: parsed.data as Record<string, unknown>,
    changeDescription: "Configuración de licencia actualizada",
    result: "success",
  });

  return NextResponse.json({ success: true });
}, { endpoint: "PATCH /api/admin/license" });