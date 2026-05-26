import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { z } from "zod";

const createPostSchema = z.object({
  content_type: z.enum(["post", "story", "carousel"]),
  caption: z.string().max(2200).optional(),
  image_url: z.string().url().optional(),
  media_urls: z.array(z.string().url()).max(10).optional(),
  product_tags: z.array(z.object({
    productoId: z.string(),
    nombre: z.string(),
    precio: z.number(),
  })).optional(),
  scheduled_for: z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId } = ctx;
  const supabase = createServiceClient();

  const status = req.nextUrl.searchParams.get("status");

  let query = supabase
    .from("instagram_posts")
    .select("*")
    .eq("store_id", storeId);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Error obteniendo posts" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId } = ctx;
  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = createPostSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { content_type, caption, image_url, media_urls, product_tags, scheduled_for } = parsed.data;

  const now = new Date().toISOString();
  const status = scheduled_for ? "scheduled" : "published";
  const published_at = !scheduled_for ? now : null;

  const { data: post, error: postError } = await supabase
    .from("instagram_posts")
    .insert({
      store_id: storeId,
      content_type,
      caption: caption || null,
      image_url: image_url || null,
      product_tags: product_tags || [],
      status,
      scheduled_for: scheduled_for || null,
      published_at,
    })
    .select()
    .single();

  if (postError) {
    return NextResponse.json({ error: "Error creando post" }, { status: 500 });
  }

  // Insert carousel media if provided
  if (media_urls && media_urls.length > 0) {
    const mediaRows = media_urls.map((url, idx) => ({
      post_id: post.id,
      media_url: url,
      media_type: "image" as const,
      sort_order: idx,
    }));

    const { error: mediaError } = await supabase
      .from("instagram_post_media")
      .insert(mediaRows);

    if (mediaError) {
      return NextResponse.json({ error: "Error añadiendo media" }, { status: 500 });
    }
  }

  return NextResponse.json(post, { status: 201 });
}
