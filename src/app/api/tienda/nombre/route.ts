import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";
import { autorizarCanales } from "@/lib/canales/infrastructure/autorizacion";

// Nombre de la tienda para cualquier usuario de la tienda (sidebar y recibo
// del POS). GET /api/settings es solo admin (SEC-07: RUT, tokens, licencia) y
// el storeWorker veía "PetShop" (QA 2026-09-27). Solo expone `name`.
export const GET = withErrorLogging(async () => {
  const ctx = await autorizarCanales({ soloAdmin: false });
  if (!ctx.ok) return ctx.response;

  const { data, error } = await createServiceClient()
    .from("stores")
    .select("name")
    .eq("id", ctx.storeId)
    .single();

  if (error || !data) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json({ name: data.name });
}, { endpoint: "GET /api/tienda/nombre" });
