import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus } from "@/lib/admin-check";
import { auth } from "@clerk/nextjs/server";
import { syncProductsToHub } from "@/lib/hub-sync";

const HUB_SYNC_SECRET = process.env.HUB_SYNC_SECRET;
const STORE_ID = process.env.STORE_ID;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const isHubCall =
    !!HUB_SYNC_SECRET && authHeader === `Bearer ${HUB_SYNC_SECRET}`;

  let storeId: string;

  if (isHubCall) {
    if (!STORE_ID) {
      return NextResponse.json(
        { error: "STORE_ID no configurado en esta instancia" },
        { status: 500 }
      );
    }
    storeId = STORE_ID;
  } else {
    const ctx = await getStoreId();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionClaims } = await auth();
    const admin = getAdminStatus(sessionClaims);

    if (!admin?.isStoreAdmin && !admin?.isSystemAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    storeId = ctx.storeId;
  }

  const supabase = createServiceClient();

  const { data: productos, error } = await supabase
    .from("productos")
    .select(
      "id, nombre, marca, codigo_barra, precio, stock, activo, tipo_animal, peso_gramos, en_oferta, precio_oferta, imagen_url, categorias(nombre)"
    )
    .eq("store_id", storeId)
    .eq("activo", true)
    .gte("precio", 1000);

  if (error) {
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }

  if (!productos || productos.length === 0) {
    return NextResponse.json({ ok: true, synced: 0 });
  }

  syncProductsToHub(
    productos.map((p) => ({
      producto_id: p.id,
      nombre_producto: p.nombre,
      marca: p.marca ?? undefined,
      codigo_barra: p.codigo_barra ?? null,
      precio: Number(p.precio),
      stock: p.stock,
      tipo_animal: p.tipo_animal ?? undefined,
      peso_gramos: p.peso_gramos ?? undefined,
      precio_oferta: p.precio_oferta ? Number(p.precio_oferta) : undefined,
      en_oferta: p.en_oferta ?? false,
      categoria: (p.categorias as unknown as { nombre: string } | null)?.nombre ?? undefined,
      imagen_url: p.imagen_url ?? null,
      activo: p.activo ?? true,
    }))
  );

  return NextResponse.json({ ok: true, synced: productos.length });
}