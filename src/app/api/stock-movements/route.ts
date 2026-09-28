import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const productoId = req.nextUrl.searchParams.get("productoId");
  if (!productoId) return NextResponse.json({ error: "productoId requerido" }, { status: 400 });

  // Verify product belongs to this store
  const { data: producto } = await supabase
    .from("productos")
    .select("id")
    .eq("id", productoId)
    .eq("store_id", store_id)
    .single();
  if (!producto) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const { data, error } = await supabase
    .from("stock_movements")
    .select("id, tipo, cantidad, notas, created_at, user_id, referencia_id")
    .eq("producto_id", productoId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  // La venta por unidad (crear_venta_tx) registra el movimiento sin user_id:
  // el usuario es el vendedor de la venta referenciada (filtrada por tienda).
  // Una venta sin vendedor (ej. orden de canal) sigue como "Sistema".
  const refsSinUsuario = [...new Set((data ?? [])
    .filter((m) => !m.user_id && m.referencia_id)
    .map((m) => m.referencia_id as string))];
  const vendedorPorVenta: Record<string, string> = {};
  if (refsSinUsuario.length > 0) {
    const { data: ventas } = await supabase
      .from("ventas")
      .select("id, worker_clerk_id")
      .in("id", refsSinUsuario)
      .eq("store_id", store_id);
    for (const v of ventas ?? []) {
      if (v.worker_clerk_id) vendedorPorVenta[v.id] = v.worker_clerk_id;
    }
  }
  const usuarioDe = (m: { user_id: string | null; referencia_id: string | null }) =>
    m.user_id ?? (m.referencia_id ? vendedorPorVenta[m.referencia_id] : undefined) ?? null;

  // Enrich with user names from clerk_users
  const userIds = [...new Set((data ?? []).map(usuarioDe).filter(Boolean))] as string[];
  const userMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("clerk_users")
      .select("clerk_id, nombre, email")
      .in("clerk_id", userIds);
    for (const u of users ?? []) {
      userMap[u.clerk_id] = u.nombre ?? u.email;
    }
  }

  const enriched = (data ?? []).map(({ referencia_id: _ref, ...m }) => {
    const uid = usuarioDe({ user_id: m.user_id, referencia_id: _ref });
    return { ...m, user_name: uid ? (userMap[uid] ?? "Usuario desconocido") : "Sistema" };
  });

  return NextResponse.json(enriched);
}, { endpoint: "GET /api/stock-movements" });
