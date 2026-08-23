/**
 * Tests U-152 a U-157: src/lib/r2-storage.ts
 *
 * A diferencia de tests/integration/api/productos-imagenes.test.ts (que mockea
 * este módulo por completo), aquí se ejecuta la implementación REAL de
 * eliminarImagenProducto() — es la única barrera de aislamiento multi-tenant
 * para el borrado de objetos en R2 y no tenía ningún test que la ejercitara.
 */
import sharp from "sharp";

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
  const actual = jest.requireActual("@aws-sdk/client-s3");
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  createR2Client,
  optimizarImagenProducto,
  subirImagenProducto,
  eliminarImagenProducto,
} from "@/lib/r2-storage";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const OTRO_STORE_ID = "223e4567-e89b-12d3-a456-426614174099";
const PRODUCTO_ID = "323e4567-e89b-12d3-a456-426614174050";

const R2_ENV = {
  R2_ACCOUNT_ID: "acc123",
  R2_ACCESS_KEY_ID: "key123",
  R2_SECRET_ACCESS_KEY: "secret123",
  R2_BUCKET_NAME: "demo-ammapet",
  R2_PUBLIC_URL: "https://pub-test.r2.dev",
};

function setR2Env(overrides: Partial<Record<keyof typeof R2_ENV, string | undefined>> = {}) {
  const merged = { ...R2_ENV, ...overrides };
  (Object.keys(merged) as (keyof typeof R2_ENV)[]).forEach((k) => {
    const v = merged[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
}

function clearR2Env() {
  (Object.keys(R2_ENV) as (keyof typeof R2_ENV)[]).forEach((k) => delete process.env[k]);
}

async function makeTestImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 50, b: 50 } },
  })
    .png()
    .toBuffer();
}

describe("createR2Client / getR2Config", () => {
  afterEach(() => clearR2Env());

  it("U-152: lanza error si falta alguna variable de entorno de R2", () => {
    setR2Env({ R2_PUBLIC_URL: undefined });
    expect(() => createR2Client()).toThrow(/Faltan variables de entorno de R2/);
  });

  it("U-158: crea el cliente sin lanzar cuando todas las variables están presentes", () => {
    setR2Env();
    expect(() => createR2Client()).not.toThrow();
  });
});

describe("optimizarImagenProducto", () => {
  it("U-153: convierte a WebP y redimensiona una imagen más ancha que el máximo (1200px)", async () => {
    const input = await makeTestImage(2000, 1000);
    const output = await optimizarImagenProducto(input);
    const meta = await sharp(output).metadata();

    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(600); // proporción mantenida (2000:1000 → 1200:600)
  });

  it("U-154: no agranda una imagen más pequeña que el máximo (withoutEnlargement)", async () => {
    const input = await makeTestImage(300, 200);
    const output = await optimizarImagenProducto(input);
    const meta = await sharp(output).metadata();

    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(200);
  });
});

describe("subirImagenProducto", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setR2Env();
    mockSend.mockResolvedValue({});
    jest.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("11111111-1111-1111-1111-111111111111");
  });

  afterEach(() => {
    clearR2Env();
    jest.restoreAllMocks();
  });

  it("U-155: sube el buffer con key productos/{storeId}/{productoId}/{uuid}.webp y retorna la URL pública", async () => {
    const buffer = Buffer.from("fake-webp-bytes");
    const url = await subirImagenProducto(STORE_ID, PRODUCTO_ID, buffer);

    expect(url).toBe(
      `https://pub-test.r2.dev/productos/${STORE_ID}/${PRODUCTO_ID}/11111111-1111-1111-1111-111111111111.webp`
    );
    expect(mockSend).toHaveBeenCalledTimes(1);

    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "demo-ammapet",
      Key: `productos/${STORE_ID}/${PRODUCTO_ID}/11111111-1111-1111-1111-111111111111.webp`,
      ContentType: "image/webp",
    });
  });
});

describe("eliminarImagenProducto — aislamiento multi-tenant", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setR2Env();
    mockSend.mockResolvedValue({});
  });

  afterEach(() => clearR2Env());

  it("U-156: borra el objeto cuando la URL pertenece a la tienda (key con prefijo correcto)", async () => {
    const url = `https://pub-test.r2.dev/productos/${STORE_ID}/foto.webp`;

    await eliminarImagenProducto(url, STORE_ID);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "demo-ammapet",
      Key: `productos/${STORE_ID}/foto.webp`,
    });
  });

  it("U-157: rechaza y NO llama al cliente S3 cuando la URL pertenece a otra tienda (IDOR)", async () => {
    const url = `https://pub-test.r2.dev/productos/${OTRO_STORE_ID}/foto.webp`;

    await expect(eliminarImagenProducto(url, STORE_ID)).rejects.toThrow(
      "URL de imagen no pertenece a esta tienda"
    );
    expect(mockSend).not.toHaveBeenCalled();
  });
});
