import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { getChannel } from "@/lib/canales/registry";
import { CanalProducto, CanalId, CanalConfig } from "@/lib/canales/types";
import { logAudit, getRequestMetadata } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId, userId } = ctx;

  const body = await req.json();
  const { canal_id } = body;

  if (!canal_id) {
    return NextResponse.json({ error: "canal_id requerido" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: config, error: configError } = await supabase
    .from("canal_config")
    .select("id, activo")
    .eq("store_id", storeId)
    .eq("canal_id", canal_id)
    .single();

  if (configError || !config) {
    return NextResponse.json({ error: "Canal no configurado" }, { status: 404 });
  }

  if (!config.activo) {
    return NextResponse.json({ error: "Canal inactivo" }, { status: 400 });
  }

  const { data: productos } = await supabase
    .from("productos")
    .select("id, nombre, sku, activo")
    .eq("store_id", storeId)
    .eq("activo", true);

  const { data: precios } = await supabase
    .from("canal_producto_config")
    .select("producto_id, precio, activo")
    .eq("store_id", storeId)
    .eq("canal_id", canal_id);

  const precioMap = new Map((precios ?? []).map((p) => [p.producto_id, p]));

  const catalogItems: CanalProducto[] = (productos ?? []).map((p) => {
    const precioConfig = precioMap.get(p.id);
    return {
      productoId: p.sku,
      precio: precioConfig?.precio ?? 0,
      activo: p.activo && (precioConfig?.activo ?? true),
      descripcionCanal: p.nombre,
    };
  });

  const canalIdTyped = canal_id as CanalId;
  try {
    const channel = getChannel(canalIdTyped);
    const config: CanalConfig = {
      storeId,
      canalId: canalIdTyped,
      externalStoreId: "",
      credentials: {},
      comisionPct: 0,
    };
    await channel.syncCatalog(config, catalogItems);

    await logAudit({
      storeId,
      userId,
      action: "SYNC",
      entityType: "canal_catalog",
      entityId: config.id,
      changeDescription: `Catálogo sincronizado con ${canal_id}`,
      ipAddress: (await getRequestMetadata(req)).ipAddress,
      userAgent: (await getRequestMetadata(req)).userAgent,
      result: "success",
    });

    return NextResponse.json({
      status: "synced",
      productos: catalogItems.length,
    });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json({ error: "Error sincronizando catálogo" }, { status: 500 });
  }
}