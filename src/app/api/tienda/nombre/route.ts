import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";
import { autorizarCanales } from "@/lib/canales/infrastructure/autorizacion";

// Nombre y RUT de la tienda para cualquier usuario de la tienda (sidebar y
// recibo del POS). GET /api/settings es solo admin (SEC-07: tokens, licencia)
// y el storeWorker veía "PetShop" (QA 2026-09-27). Solo expone `name` y `rut`:
// el RUT de la tienda es público (va impreso en cada recibo, igual que en
// /api/recibos/[ventaId]).
export const GET = withErrorLogging(async () => {
  const ctx = await autorizarCanales({ soloAdmin: false });
  if (!ctx.ok) return ctx.response;

  const { data, error } = await createServiceClient()
    .from("stores")
    .select("name, rut")
    .eq("id", ctx.storeId)
    .single();

  if (error || !data) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json({ name: data.name, rut: data.rut ?? null });
}, { endpoint: "GET /api/tienda/nombre" });
