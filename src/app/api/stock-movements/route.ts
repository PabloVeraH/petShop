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
    .select("id, tipo, cantidad, notas, created_at, user_id")
    .eq("producto_id", productoId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  // Enrich with user names from clerk_users
  const userIds = [...new Set((data ?? []).map((m) => m.user_id).filter(Boolean))] as string[];
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

  const enriched = (data ?? []).map((m) => ({
    ...m,
    user_name: m.user_id ? (userMap[m.user_id] ?? "Usuario desconocido") : "Sistema",
  }));

  return NextResponse.json(enriched);
}, { endpoint: "GET /api/stock-movements" });
