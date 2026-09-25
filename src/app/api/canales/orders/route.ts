import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";
import { esCanalExterno } from "@/lib/canales/domain/types";
import { esEstadoOrden } from "@/lib/canales/domain/estados";

// Órdenes de canales externos de la tienda (Fase 3). Cualquier usuario de la
// tienda las ve: el storeWorker prepara y marca "lista" (D8).
// El POST manual anterior (accept/reject sin crear venta — C13) se eliminó:
// la aceptación es automática (D5).
const ESTADOS_POR_DEFECTO = ["processing", "accepted", "ready", "failed"];

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canal = req.nextUrl.searchParams.get("canal");
  const estado = req.nextUrl.searchParams.get("estado");
  if (canal && !esCanalExterno(canal)) return NextResponse.json({ error: "Canal inválido" }, { status: 400 });
  if (estado && !esEstadoOrden(estado)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });

  let query = createServiceClient()
    .from("canal_ordenes")
    .select("id, canal_id, external_order_id, estado, items, total_externo, venta_id, motivo_rechazo, ultimo_error, created_at, accepted_at, ready_at")
    .eq("store_id", ctx.storeId);
  if (canal) query = query.eq("canal_id", canal);
  query = estado ? query.eq("estado", estado) : query.in("estado", ESTADOS_POR_DEFECTO);

  const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Error obteniendo órdenes" }, { status: 500 });
  return NextResponse.json(data ?? []);
}, { endpoint: "GET /api/canales/orders" });
