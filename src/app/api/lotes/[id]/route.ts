import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus } from "@/lib/admin-check";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { LoteUpdateSchema } from "@/lib/validation";

async function requireAdmin() {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  if (!admin) return null;
  if (!admin.isSystemAdmin && !admin.isStoreAdmin) return null;
  return admin;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCtx = await getStoreId();
  if (!authCtx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { storeId, userId } = authCtx;
  const { id } = await params;
  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = LoteUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { data: existing, error: fetchErr } = await supabase
    .from("lotes_producto")
    .select("*")
    .eq("id", id)
    .eq("store_id", storeId)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
  }

  const { cantidad_inicial: _ignored, ...safeUpdate } = parsed.data as Record<string, unknown>;

  const { data: updated, error } = await supabase
    .from("lotes_producto")
    .update({ ...safeUpdate, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("store_id", storeId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    storeId,
    userId: userId || "unknown",
    action: "UPDATE",
    entityType: "lote_producto",
    entityId: id,
    oldValues: existing,
    newValues: updated,
    ipAddress: (await getRequestMetadata(req)).ipAddress,
    userAgent: (await getRequestMetadata(req)).userAgent,
    result: "success",
  });

  return NextResponse.json({ lote: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCtx = await getStoreId();
  if (!authCtx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { storeId, userId } = authCtx;
  const { id } = await params;
  const supabase = createServiceClient();

  const { data: existing, error: fetchErr } = await supabase
    .from("lotes_producto")
    .select("*")
    .eq("id", id)
    .eq("store_id", storeId)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
  }

  const { error } = await supabase
    .from("lotes_producto")
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("store_id", storeId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    storeId,
    userId: userId || "unknown",
    action: "DELETE",
    entityType: "lote_producto",
    entityId: id,
    oldValues: existing,
    ipAddress: (await getRequestMetadata(req)).ipAddress,
    userAgent: (await getRequestMetadata(req)).userAgent,
    result: "success",
  });

  return NextResponse.json({ ok: true });
}