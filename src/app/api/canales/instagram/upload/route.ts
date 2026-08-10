import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId } = ctx;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) return NextResponse.json({ error: "No se recibió archivo" }, { status: 400 });
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Tipo de archivo no permitido" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "El archivo supera los 10 MB" }, { status: 400 });
  }

  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${storeId}/${Date.now()}.${ext}`;

  const supabase = createServiceClient();
  const { error } = await supabase.storage
    .from("instagram-media")
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    console.error("[POST /api/canales/instagram/upload] Error:", error);
    return NextResponse.json({ error: "Error subiendo imagen" }, { status: 500 });
  }

  const { data: urlData } = supabase.storage.from("instagram-media").getPublicUrl(path);
  return NextResponse.json({ url: urlData.publicUrl }, { status: 201 });
}, { endpoint: "POST /api/canales/instagram/upload" });
