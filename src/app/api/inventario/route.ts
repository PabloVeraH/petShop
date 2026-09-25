import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { z } from "zod";
import { withErrorLogging } from "@/lib/audit";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const searchSchema = z.string().max(100); // Limit search length
  const searchResult = searchSchema.safeParse(req.nextUrl.searchParams.get("search"));
  const search = searchResult.success ? searchResult.data : "";
  
  const soloAlertas = req.nextUrl.searchParams.get("alertas") === "1";
  const soloVencimientos = req.nextUrl.searchParams.get("vencimiento") === "1";
  const conLotes = req.nextUrl.searchParams.get("con_lotes") === "1";

  let query = supabase
    .from("productos")
    .select("id, nombre, sku, precio, costo, stock, stock_minimo, marca, peso_gramos, precio_venta_kg, fecha_vencimiento, dias_alerta_expira, precio_oferta, en_oferta, categoria_id, imagen_url, imagen_url_2")
    .eq("store_id", store_id)
    .eq("activo", true)
    .order("nombre");

  if (search) {
    // Sanitize to prevent PostgREST filter string manipulation
    const s = search.replace(/[()%,]/g, "");
    query = query.or(`nombre.ilike.%${s}%,sku.ilike.%${s}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const productos = data ?? [];
  let result = productos;

  if (soloAlertas) {
    result = result.filter((p) => p.stock <= p.stock_minimo);
  }

  if (soloVencimientos) {
    result = result.filter((p) => p.fecha_vencimiento !== null);
  }

  if (conLotes) {
    const productoIds = result.map((p) => p.id);
    const { data: lotes } = await supabase
      .from("lotes_producto")
      .select("*")
      .eq("store_id", store_id)
      .eq("activo", true)
      .in("producto_id", productoIds);

    const lotesPorProducto: Record<string, typeof lotes> = {};
    (lotes ?? []).forEach((l) => {
      if (!lotesPorProducto[l.producto_id]) lotesPorProducto[l.producto_id] = [];
      lotesPorProducto[l.producto_id]!.push(l);
    });

    result = result.map((p) => ({
      ...p,
      lotes: lotesPorProducto[p.id] ?? [],
    }));
  }

  // Granel (G11): gramos del saco abierto para mostrar "N sacos + X kg" y
  // para el conteo físico / deshacer apertura.
  const granelIds = result.filter((p) => Number(p.precio_venta_kg) > 0).map((p) => p.id);
  if (granelIds.length > 0) {
    const { data: sacos, error: sacosError } = await supabase
      .from("sacos_abiertos")
      .select("producto_id, gramos_restantes")
      .eq("store_id", store_id)
      .in("producto_id", granelIds)
      .is("cerrado_at", null);
    if (sacosError) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

    const gramosPorProducto = new Map((sacos ?? []).map((s) => [s.producto_id, Number(s.gramos_restantes)]));
    result = result.map((p) =>
      granelIds.includes(p.id) ? { ...p, saco_abierto_gramos: gramosPorProducto.get(p.id) ?? null } : p
    );
  }

  return NextResponse.json(result);
}, { endpoint: "GET /api/inventario" });
