import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

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
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId } = ctx;
  const supabase = createServiceClient();

  const { clerk_id, rut, meta_ventas } = await req.json();
  if (!clerk_id) return NextResponse.json({ error: "clerk_id requerido" }, { status: 400 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (rut !== undefined) updates.rut = rut || null;
  if (meta_ventas !== undefined) updates.meta_ventas = meta_ventas ? Number(meta_ventas) : null;

  const { error } = await supabase
    .from("clerk_users")
    .update(updates)
    .eq("clerk_id", clerk_id)
    .eq("store_id", storeId);

  if (error) return NextResponse.json({ error: "Error interno" }, { status: 500 });
  return NextResponse.json({ ok: true });
}