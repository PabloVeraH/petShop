import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

const MAX_IMAGE_WIDTH = 1200;
const WEBP_QUALITY = 80;

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
    throw new Error(
      "Faltan variables de entorno de R2: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL"
    );
  }

  return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

export function createR2Client(): S3Client {
  const { accountId, accessKeyId, secretAccessKey } = getR2Config();

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function optimizarImagenProducto(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

export async function subirImagenProducto(
  storeId: string,
  productoId: string,
  buffer: Buffer
): Promise<string> {
  const { bucketName, publicUrl } = getR2Config();
  const client = createR2Client();
  const key = `productos/${storeId}/${productoId}/${crypto.randomUUID()}.webp`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: "image/webp",
    })
  );

  return `${publicUrl}/${key}`;
}

export async function eliminarImagenProducto(
  url: string,
  storeId: string
): Promise<void> {
  const { bucketName, publicUrl } = getR2Config();
  const client = createR2Client();

  const prefix = `${publicUrl}/productos/${storeId}/`;
  if (!url.startsWith(prefix)) {
    throw new Error("URL de imagen no pertenece a esta tienda");
  }

  const key = url.slice(`${publicUrl}/`.length);

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    })
  );
}
