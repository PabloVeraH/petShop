import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

// Motor de recompra inteligente: cruza consumo_alertas con proveedor_productos
// para saber cuándo ordenar antes de que se acabe el stock
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users").select("store_id").eq("clerk_id", userId).single();
  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

  // Get consumo_alertas for this store's clients
  const { data: clientes } = await supabase
    .from("clientes").select("id").eq("store_id", user.store_id);
  const clienteIds = (clientes ?? []).map((c) => c.id);
  if (!clienteIds.length) return NextResponse.json([]);

  const { data: alertas } = await supabase
    .from("consumo_alertas")
    .select("producto_id, fecha_estimada_termino, mascotas(nombre), clientes(nombre)")
    .in("cliente_id", clienteIds)
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
    .eq("store_id", user.store_id);

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
