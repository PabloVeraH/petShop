import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { z } from "zod";

const updatePostSchema = z.object({
  caption: z.string().max(2200).optional(),
  image_url: z.string().url().optional(),
  product_tags: z.array(z.object({
    productoId: z.string(),
    nombre: z.string(),
    precio: z.number(),
  })).optional(),
  scheduled_for: z.string().datetime().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId } = ctx;
  const supabase = createServiceClient();

  const { id } = await params;

  // Verify post exists and belongs to this store
  const { data: post, error: fetchError } = await supabase
    .from("instagram_posts")
    .select("status")
    .eq("id", id)
    .eq("store_id", storeId)
    .single();

  if (fetchError || !post) {
    return NextResponse.json({ error: "Post no encontrado" }, { status: 404 });
  }

  // Prevent editing published posts
  if (post.status === "published") {
    return NextResponse.json({ error: "No puedes editar posts publicados" }, { status: 409 });
  }

  const body = await req.json();
  const parsed = updatePostSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.caption !== undefined) updates.caption = parsed.data.caption || null;
  if (parsed.data.image_url !== undefined) updates.image_url = parsed.data.image_url || null;
  if (parsed.data.product_tags !== undefined) updates.product_tags = parsed.data.product_tags || [];
  if (parsed.data.scheduled_for !== undefined) updates.scheduled_for = parsed.data.scheduled_for || null;

  const { data, error } = await supabase
    .from("instagram_posts")
    .update(updates)
    .eq("id", id)
    .eq("store_id", storeId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Error actualizando post" }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId } = ctx;
  const supabase = createServiceClient();

  const { id } = await params;

  // Verify post exists and belongs to this store
  const { data: post, error: fetchError } = await supabase
    .from("instagram_posts")
    .select("status")
    .eq("id", id)
    .eq("store_id", storeId)
    .single();

  if (fetchError || !post) {
    return NextResponse.json({ error: "Post no encontrado" }, { status: 404 });
  }

  // Prevent deleting published posts
  if (post.status === "published") {
    return NextResponse.json({ error: "No puedes eliminar posts publicados" }, { status: 409 });
  }

  // Delete cascades to instagram_post_media via foreign key
  const { error } = await supabase
    .from("instagram_posts")
    .delete()
    .eq("id", id)
    .eq("store_id", storeId);

  if (error) {
    return NextResponse.json({ error: "Error eliminando post" }, { status: 500 });
  }

  return NextResponse.json({ status: "deleted" }, { status: 200 });
}
