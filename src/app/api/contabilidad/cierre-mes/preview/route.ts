import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { auth } from "@clerk/nextjs/server";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { computeCierrePreview } from "@/lib/contabilidad/cierre-mes";

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  try {
    requireStoreAdmin(admin, store_id);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const mes = parseInt(searchParams.get("mes") ?? "");
  const año = parseInt(searchParams.get("año") ?? "");
  const calcular_costo_venta = searchParams.get("calcular_costo_venta") !== "false";

  if (!mes || mes < 1 || mes > 12 || !año || año < 2020 || año > 2100) {
    return NextResponse.json(
      { error: "Parámetros inválidos: mes (1-12) y año (2020-2100) son requeridos" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  const preview = await computeCierrePreview(supabase, store_id, mes, año, calcular_costo_venta);

  return NextResponse.json(preview);
}
