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
    .select("id, nombre, sku, stock, fecha_vencimiento, dias_alerta_expira_expira, precio_oferta, en_oferta")
    .eq("store_id", store_id)
    .eq("activo", true)
    .not("fecha_vencimiento", "is", null)
    .order("fecha_vencimiento", { ascending: true });

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  const productos = data ?? [];

  // Clasificar en vencidos y próximos
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

  return NextResponse.json({
    hoy,
    vencidos,
    proximos,
    totalUnidadesVencidas: vencidos.reduce((sum, p) => sum + p.stock, 0),
  });
}
