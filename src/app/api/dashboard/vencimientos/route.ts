import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const hoy = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("productos")
    .select("id, nombre, sku, stock, fecha_vencimiento, dias_alerta_expira, precio_oferta, en_oferta")
    .eq("store_id", store_id)
    .eq("activo", true)
    .not("fecha_vencimiento", "is", null)
    .order("fecha_vencimiento", { ascending: true });

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const productos = data ?? [];

  const vencidos = productos.filter((p) => p.fecha_vencimiento < hoy && p.stock > 0);

  const proximos = productos
    .filter((p) => {
      if (p.fecha_vencimiento < hoy) return false;
      if (p.stock <= 0) return false;
      const diasRestantes = Math.ceil(
        (new Date(p.fecha_vencimiento).getTime() - new Date(hoy).getTime()) / 86400000
      );
      return diasRestantes <= (p.dias_alerta_expira ?? 0);
    })
    .map((p) => ({
      ...p,
      diasRestantes: Math.ceil(
        (new Date(p.fecha_vencimiento).getTime() - new Date(hoy).getTime()) / 86400000
      ),
    }));

  const { data: lotes } = await supabase
    .from("lotes_producto")
    .select("*, producto:productos(id, nombre, sku, stock, dias_alerta_expira)")
    .eq("store_id", store_id)
    .eq("activo", true)
    .gt("cantidad_actual", 0)
    .order("fecha_vencimiento", { ascending: true });

  const lotesVencidos = (lotes ?? []).filter((l) => l.fecha_vencimiento < hoy);
  const lotesProximos = (lotes ?? []).filter((l) => {
    if (l.fecha_vencimiento < hoy) return false;
    const dias = Math.floor(
      (new Date(l.fecha_vencimiento).getTime() - new Date(hoy).getTime()) / 86_400_000
    );
    return dias >= 0 && dias <= ((l.producto as { dias_alerta_expira?: number } | null)?.dias_alerta_expira ?? 30);
  });

  return NextResponse.json({
    hoy,
    vencidos,
    proximos,
    totalUnidadesVencidas: vencidos.reduce((sum, p) => sum + p.stock, 0),
    lotes: {
      vencidos: lotesVencidos,
      proximos: lotesProximos,
      totalUnidadesVencidas: lotesVencidos.reduce((s, l) => s + l.cantidad_actual, 0),
      totalUnidadesProximas: lotesProximos.reduce((s, l) => s + l.cantidad_actual, 0),
    },
  });
}