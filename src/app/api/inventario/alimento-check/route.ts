import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json([], { status: 401 });

  const ids = req.nextUrl.searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
  if (ids.length === 0) return NextResponse.json([]);

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("productos")
    .select("id, nombre, peso_gramos, categorias(es_alimento)")
    .in("id", ids)
    .eq("store_id", ctx.storeId);

  const alimentos = (data ?? [])
    .filter(p => {
      const cats = p.categorias as { es_alimento: boolean }[] | null;
      const cat = Array.isArray(cats) ? cats[0] : cats;
      return cat?.es_alimento === true;
    })
    .map(p => ({ id: p.id, nombre: p.nombre, peso_gramos: p.peso_gramos }));

  return NextResponse.json(alimentos);
}