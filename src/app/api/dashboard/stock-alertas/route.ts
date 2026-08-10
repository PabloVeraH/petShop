import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async () => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();

  const { data: allProducts, error } = await supabase
    .from("productos")
    .select("id, nombre, sku, stock, stock_minimo")
    .eq("store_id", ctx.storeId)
    .eq("activo", true)
    .order("stock", { ascending: true });

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const alertas = (allProducts ?? []).filter(
    (p) => p.stock <= (p.stock_minimo ?? 0)
  );

  // total va aparte de la lista recortada: si se devolviera solo el array
  // limitado a 10, el widget del dashboard (que cuenta con alertas.length)
  // mostraría "10" aunque haya más productos bajo mínimo — la misma
  // discrepancia con Inventario que este endpoint ya tuvo que corregir una vez.
  return NextResponse.json({ total: alertas.length, items: alertas.slice(0, 10) });
}, { endpoint: "GET /api/dashboard/stock-alertas" });
