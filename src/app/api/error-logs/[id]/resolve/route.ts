import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus, resolveAdminContext } from "@/lib/admin-check";
import { withErrorLogging } from "@/lib/audit";

export const PATCH = withErrorLogging(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  const { sessionClaims, userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let admin = getAdminStatus(sessionClaims);
  if (!admin?.isSystemAdmin && !admin?.isStoreAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Cross-verify systemAdmin claim against DB (stale JWT check)
  admin = await resolveAdminContext(admin) ?? admin;

  // Sin storeId propio, un storeAdmin no tiene tienda que filtrar: denegar en
  // vez de omitir el filtro (antes veía los registros de todas las tiendas).
  if (!admin.isSystemAdmin && !admin.storeId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = createServiceClient();

  let query = supabase
    .from("error_logs")
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .eq("id", id);
  // storeAdmin: solo logs de su tienda (antes resolvía y leía los de cualquiera).
  if (!admin.isSystemAdmin) query = query.eq("store_id", admin.storeId);

  const { data, error } = await query.select().maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data });
}, { endpoint: "PATCH /api/error-logs/id/resolve" });
