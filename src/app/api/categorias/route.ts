import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus } from "@/lib/admin-check";
import { CategoriaCreateSchema } from "@/lib/validation";
import { logAudit, getRequestMetadata } from "@/lib/audit";

export async function GET() {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("categorias")
    .select("id, nombre, descripcion, activo")
    .eq("store_id", ctx.storeId)
    .eq("activo", true)
    .order("nombre");

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { sessionClaims, userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminStatus(sessionClaims);
  if (!admin?.isSystemAdmin && !admin?.isStoreAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
  const storeId = meta?.storeId as string | undefined;
  if (!storeId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CategoriaCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("categorias")
    .insert({
      store_id: storeId,
      nombre: parsed.data.nombre.trim(),
      descripcion: parsed.data.descripcion?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    const { ipAddress, userAgent } = getRequestMetadata(req);
    logAudit({
      storeId,
      userId,
      action: "CREATE",
      entityType: "categoria",
      changeDescription: "Error creando categoría",
      ipAddress,
      userAgent,
      result: "failure",
      errorMessage: error.message,
    }).catch(() => {});
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ya existe una categoría con ese nombre" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  const { ipAddress, userAgent } = getRequestMetadata(req);
  logAudit({
    storeId,
    userId,
    action: "CREATE",
    entityType: "categoria",
    entityId: data.id,
    newValues: { nombre: parsed.data.nombre, descripcion: parsed.data.descripcion },
    changeDescription: `Categoría "${parsed.data.nombre}" creada`,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return NextResponse.json(data, { status: 201 });
}
