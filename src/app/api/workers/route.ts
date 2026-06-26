import { getStoreId } from "@/lib/auth";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { WorkerUpdateSchema } from "@/lib/validation";
import { getAdminStatus } from "@/lib/admin-check";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId } = ctx;
  const supabase = createServiceClient();

  const { data: users, error } = await supabase
    .from("clerk_users")
    .select("clerk_id, nombre, email, rut, meta_ventas, store_admin, store_worker")
    .eq("store_id", storeId)
    .eq("is_disabled", false)
    .or("store_admin.eq.true,store_worker.eq.true")
    .order("nombre");

  if (error) return NextResponse.json({ error: "Error interno" }, { status: 500 });

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data: ventasMes } = await supabase
    .from("ventas")
    .select("worker_clerk_id, total")
    .eq("store_id", storeId)
    .neq("estado", "anulada")
    .gte("created_at", startOfMonth.toISOString());

  const { data: ventasHoy } = await supabase
    .from("ventas")
    .select("worker_clerk_id, total")
    .eq("store_id", storeId)
    .neq("estado", "anulada")
    .gte("created_at", startOfDay.toISOString());

  const totalesMes: Record<string, number> = {};
  for (const v of ventasMes ?? []) {
    if (v.worker_clerk_id) {
      totalesMes[v.worker_clerk_id] = (totalesMes[v.worker_clerk_id] ?? 0) + Number(v.total);
    }
  }

  const totalesHoy: Record<string, number> = {};
  for (const v of ventasHoy ?? []) {
    if (v.worker_clerk_id) {
      totalesHoy[v.worker_clerk_id] = (totalesHoy[v.worker_clerk_id] ?? 0) + Number(v.total);
    }
  }

  const result = (users ?? []).map((u) => ({
    ...u,
    ventas_mes: totalesMes[u.clerk_id] ?? 0,
    ventas_hoy: totalesHoy[u.clerk_id] ?? 0,
  }));

  return NextResponse.json(result);
}

export async function PATCH(req: NextRequest) {
  const { sessionClaims, userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminStatus(sessionClaims);
  if (!admin?.isStoreAdmin && !admin?.isSystemAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const storeId = admin.storeId;
  if (!storeId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = createServiceClient();

  const body = await req.json();
  const wParsed = WorkerUpdateSchema.safeParse(body);
  if (!wParsed.success) return NextResponse.json({ error: wParsed.error.issues[0].message }, { status: 400 });
  const { clerk_id, rut, meta_ventas } = wParsed.data;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (rut !== undefined) updates.rut = rut ?? null;
  if (meta_ventas !== undefined) updates.meta_ventas = meta_ventas ?? null;

  const { error } = await supabase
    .from("clerk_users")
    .update(updates)
    .eq("clerk_id", clerk_id)
    .eq("store_id", storeId);

  if (error) return NextResponse.json({ error: "Error interno" }, { status: 500 });
  return NextResponse.json({ ok: true });
}