import { getStoreId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

// Motor de recompra inteligente: cruza consumo_alertas con proveedor_productos
// para saber cuándo ordenar antes de que se acabe el stock
export async function GET() {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { data: alertas } = await supabase
    .from("consumo_alertas")
    .select("producto_id, fecha_estimada_termino, mascotas(nombre), clientes(nombre)")
    .eq("store_id", store_id)
    .not("fecha_estimada_termino", "is", null);

  if (!alertas?.length) return NextResponse.json([]);

  // Get proveedor_productos for these products
  const productoIds = [...new Set(alertas.map((a) => a.producto_id))];
  const { data: proveedorProductos } = await supabase
    .from("proveedor_productos")
    .select("producto_id, costo, tiempo_entrega_dias, proveedores(id, nombre)")
    .in("producto_id", productoIds);

  const { data: productos } = await supabase
    .from("productos")
    .select("id, nombre, sku, stock, stock_minimo")
    .in("id", productoIds)
    .eq("store_id", store_id);

  const hoy = new Date();

  const sugerencias = alertas.map((alerta) => {
    const prod = productos?.find((p) => p.id === alerta.producto_id);
    const pp = proveedorProductos?.filter((pp) => pp.producto_id === alerta.producto_id) ?? [];
    const termino = new Date(alerta.fecha_estimada_termino!);
    const diasRestantes = Math.round((termino.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
    const mascota = alerta.mascotas as unknown as { nombre: string } | null;
    const cliente = alerta.clientes as unknown as { nombre: string } | null;

    const urgente = pp.some((p) => {
      const entrega = p.tiempo_entrega_dias ?? 3;
      return diasRestantes <= entrega + 2;
    });

    return {
      producto_id: alerta.producto_id,
      producto_nombre: prod?.nombre ?? "Producto",
      sku: prod?.sku ?? "",
      stock_actual: prod?.stock ?? 0,
      dias_restantes: diasRestantes,
      mascota_nombre: mascota?.nombre,
      cliente_nombre: cliente?.nombre,
      urgente,
      proveedores: pp.map((p) => ({
        id: (p.proveedores as unknown as { id: string; nombre: string } | null)?.id,
        nombre: (p.proveedores as unknown as { id: string; nombre: string } | null)?.nombre ?? "Proveedor",
        costo: p.costo,
        tiempo_entrega_dias: p.tiempo_entrega_dias ?? 3,
      })),
    };
  }).filter((s) => s.dias_restantes <= 14); // Solo mostrar alertas de 2 semanas o menos

  sugerencias.sort((a, b) => a.dias_restantes - b.dias_restantes);
  return NextResponse.json(sugerencias);
}
