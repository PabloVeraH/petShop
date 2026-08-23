import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStoreId } from "@/lib/auth";
import { optimizarImagenProducto, subirImagenProducto, eliminarImagenProducto } from "@/lib/r2-storage";
import { withErrorLogging } from "@/lib/audit";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB
const ProductoIdSchema = z.string().uuid();

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file");
  const productoIdRaw = formData.get("productoId");

  // El id del producto se genera en el cliente (crypto.randomUUID()) antes de
  // guardar el producto — ver docs/product-images.md — así la key en R2 queda
  // organizada como productos/{storeId}/{productoId}/{archivo}.webp incluso
  // para un producto que todavía no existe como fila en la base.
  const parsedProductoId = ProductoIdSchema.safeParse(productoIdRaw);
  if (!parsedProductoId.success) {
    return NextResponse.json({ error: "productoId requerido y debe ser un UUID válido" }, { status: 400 });
  }

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Tipo de archivo no permitido. Use JPEG, PNG o WebP" },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "El archivo excede el tamaño máximo de 8 MB" },
      { status: 400 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  let optimizedBuffer: Buffer;
  try {
    optimizedBuffer = await optimizarImagenProducto(inputBuffer);
  } catch {
    return NextResponse.json(
      { error: "No se pudo procesar la imagen. Asegúrese de que el archivo no esté corrupto" },
      { status: 400 }
    );
  }

  const url = await subirImagenProducto(ctx.storeId, parsedProductoId.data, optimizedBuffer);

  return NextResponse.json({ url }, { status: 201 });
}, { endpoint: "POST /api/productos/imagenes" });

export const DELETE = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { url } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL requerida" }, { status: 400 });
  }

  try {
    await eliminarImagenProducto(url, ctx.storeId);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    if (message === "URL de imagen no pertenece a esta tienda") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    return NextResponse.json({ error: "Error al eliminar imagen" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}, { endpoint: "DELETE /api/productos/imagenes" });
