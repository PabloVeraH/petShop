import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus } from "@/lib/admin-check";
import { CategoriaUpdateSchema } from "@/lib/validation";

async function requireAdmin(sessionClaims: unknown): Promise<{ storeId: string } | null> {
  const admin = getAdminStatus(sessionClaims as Parameters<typeof getAdminStatus>[0]);
  if (!admin?.isSystemAdmin && !admin?.isStoreAdmin) return null;
  const meta = (sessionClaims as Record<string, unknown>)?.publicMetadata as Record<string, unknown> | undefined;
  const storeId = meta?.storeId as string | undefined;
  return storeId ? { storeId } : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { sessionClaims, userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await requireAdmin(sessionClaims);
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const parsed = CategoriaUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.nombre !== undefined) updates.nombre = parsed.data.nombre.trim();
  if (parsed.data.descripcion !== undefined) updates.descripcion = parsed.data.descripcion?.trim() || null;
  if (parsed.data.activo !== undefined) updates.activo = parsed.data.activo;
  if (parsed.data.es_alimento !== undefined) updates.es_alimento = parsed.data.es_alimento;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("categorias")
    .update(updates)
    .eq("id", id)
    .eq("store_id", ctx.storeId)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ya existe una categoría con ese nombre" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { sessionClaims, userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await requireAdmin(sessionClaims);
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("categorias")
    .update({ activo: false })
    .eq("id", id)
    .eq("store_id", ctx.storeId);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
