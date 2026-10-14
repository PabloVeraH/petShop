import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";
import { autorizarCanales } from "@/lib/canales/infrastructure/autorizacion";

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

// El `file.type` y el nombre los manda el cliente: el tipo real (y la
// extensión con que se guarda en el bucket público) sale de los primeros bytes.
function tipoReal(b: Uint8Array): { mime: string; ext: string } | null {
  const ascii = (desde: number, hasta: number) => String.fromCharCode(...b.slice(desde, hasta));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return { mime: "image/png", ext: "png" };
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return { mime: "image/gif", ext: "gif" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await autorizarCanales({ soloAdmin: true });
  if (!ctx.ok) return ctx.response;
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

  const real = tipoReal(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!real) {
    return NextResponse.json({ error: "El archivo no es una imagen válida" }, { status: 400 });
  }

  const path = `${storeId}/${Date.now()}.${real.ext}`;

  const supabase = createServiceClient();
  const { error } = await supabase.storage
    .from("instagram-media")
    .upload(path, file, { contentType: real.mime, upsert: false });

  if (error) {
    console.error("[POST /api/canales/instagram/upload] Error:", error);
    return NextResponse.json({ error: "Error subiendo imagen" }, { status: 500 });
  }

  const { data: urlData } = supabase.storage.from("instagram-media").getPublicUrl(path);
  return NextResponse.json({ url: urlData.publicUrl }, { status: 201 });
}, { endpoint: "POST /api/canales/instagram/upload" });
