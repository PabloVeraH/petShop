import { createServiceClient } from "@/lib/supabase";

export interface ReorderSuggestion {
  producto_id: string;
  producto_nombre: string;
  sku: string;
  stock_actual: number;
  stock_minimo: number;
  demanda_promedio: number;
  dias_restantes: number;
  cantidad_sugerida: number;
  proveedor: {
    id: string;
    nombre: string;
    tiempo_entrega: number;
    costo: number;
  };
  urgencia: "critica" | "alta" | "media" | "baja";
  razon: string;
  tendencia: "creciendo" | "estable" | "bajando";
}

export function calculateROP(
  demandaDiaria: number,
  leadTimeDias: number,
  diasSeguridad: number = 7
): number {
  return Math.ceil(demandaDiaria * leadTimeDias + demandaDiaria * diasSeguridad);
}

export function calculateEOQ(
  demandaAnual: number,
  costoOrden: number,
  costoProducto: number,
  costoMantenimientoPct: number = 0.2
): number {
  if (costoProducto <= 0 || costoMantenimientoPct <= 0) return 0;
  const optimal = Math.sqrt((2 * demandaAnual * costoOrden) / (costoProducto * costoMantenimientoPct));
  return Math.ceil(optimal);
}

async function getDemandaDiariaFallback(
  supabase: ReturnType<typeof createServiceClient>,
  productoId: string,
  storeId: string,
  diasHistorial: number = 30
): Promise<number> {
  const desde = new Date();
  desde.setDate(desde.getDate() - diasHistorial);
  const desdeStr = desde.toISOString();

  const { data: ventasIds } = await supabase
    .from("ventas")
    .select("id")
    .eq("store_id", storeId)
    .gte("created_at", desdeStr);

  if (!ventasIds?.length) return 0;

  const ids = ventasIds.map(v => v.id);

  const { data: items } = await supabase
    .from("venta_items")
    .select("cantidad")
    .eq("producto_id", productoId)
    .in("venta_id", ids);

  if (!items?.length) return 0;

  const total = items.reduce((sum, item) => sum + item.cantidad, 0);
  return Math.max(0.1, total / diasHistorial);
}

export async function getReorderSuggestions(storeId: string): Promise<ReorderSuggestion[]> {
  const supabase = createServiceClient();

  const { data: productos } = await supabase
    .from("productos")
    .select("id, nombre, sku, stock, stock_minimo, demanda_promedio_diaria, dias_seguridad, tendencia_ventas")
    .eq("store_id", storeId)
    .eq("activo", true);

  if (!productos?.length) return [];

  const productoIds = productos.map(p => p.id);

  const { data: proveedorProductos } = await supabase
    .from("proveedor_productos")
    .select("producto_id, costo, tiempo_entrega_dias, proveedores(id, nombre)")
    .in("producto_id", productoIds);

  const sugerencias: ReorderSuggestion[] = [];

  for (const prod of productos) {
    const demandaDiaria: number =
      prod.demanda_promedio_diaria > 0
        ? prod.demanda_promedio_diaria
        : await getDemandaDiariaFallback(supabase, prod.id, storeId);

    if (demandaDiaria <= 0) continue;

    const pp = (proveedorProductos || []).filter(p => p.producto_id === prod.id);
    if (!pp.length) continue;

    const mejorProv = pp.reduce((best, curr) => {
      const currScore = (curr.tiempo_entrega_dias ?? 99) * 10 + Number(curr.costo ?? 0);
      const bestScore = (best.tiempo_entrega_dias ?? 99) * 10 + Number(best.costo ?? 0);
      return currScore < bestScore ? curr : best;
    }, pp[0]);

    const leadTime = mejorProv.tiempo_entrega_dias ?? 3;
    const diasSeguridad = prod.dias_seguridad ?? 7;
    const rop = calculateROP(demandaDiaria, leadTime, diasSeguridad);
    const diasRestantes = Math.floor(prod.stock / demandaDiaria);
    const cantidadSugerida = Math.max(0, rop - prod.stock + Math.ceil(demandaDiaria * leadTime));

    let urgencia: ReorderSuggestion["urgencia"] = "baja";
    if (diasRestantes <= leadTime) urgencia = "critica";
    else if (diasRestantes <= leadTime + diasSeguridad) urgencia = "alta";
    else if (diasRestantes <= leadTime * 2) urgencia = "media";

    let razon: string;
    if (diasRestantes <= leadTime) {
      razon = `Stock actual (${prod.stock}) cubre solo ${diasRestantes} días. Tiempo de entrega: ${leadTime} días.`;
    } else if (prod.stock <= prod.stock_minimo) {
      razon = `Stock bajo mínimo (${prod.stock}/${prod.stock_minimo}).`;
    } else {
      razon = `Reorder point alcanzado: ${rop} unidades.`;
    }

    const proveedorData = mejorProv.proveedores as unknown as { id: string; nombre: string } | null;

    sugerencias.push({
      producto_id: prod.id,
      producto_nombre: prod.nombre,
      sku: prod.sku,
      stock_actual: prod.stock,
      stock_minimo: prod.stock_minimo,
      demanda_promedio: Math.round(demandaDiaria * 100) / 100,
      cantidad_sugerida: cantidadSugerida,
      dias_restantes: diasRestantes,
      proveedor: {
        id: proveedorData?.id ?? "",
        nombre: proveedorData?.nombre ?? "Sin nombre",
        tiempo_entrega: leadTime,
        costo: Number(mejorProv.costo ?? 0),
      },
      urgencia,
      razon,
      tendencia: (prod.tendencia_ventas as ReorderSuggestion["tendencia"]) ?? "estable",
    });
  }

  const urgenciaOrden: Record<string, number> = { critica: 0, alta: 1, media: 2, baja: 3 };
  return sugerencias
    .filter(s => urgenciaOrden[s.urgencia] < 3)
    .sort((a, b) => urgenciaOrden[a.urgencia] - urgenciaOrden[b.urgencia]);
}
