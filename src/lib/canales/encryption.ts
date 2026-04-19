/**
 * Cifrado AES-256-GCM para credenciales y secretos
 * Clave almacenada en ENCRYPTION_KEY (variable de entorno del servidor)
 */

import crypto from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is not set");
}

// Validar que la clave sea de 32 bytes (256 bits)
const keyBuffer = Buffer.from(ENCRYPTION_KEY, "hex");
if (keyBuffer.length !== 32) {
  throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex characters)");
}

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Cifra un string con AES-256-GCM
 * Retorna un objeto con ciphertext, iv, y authTag (todos en hex)
 */
export function encrypt(plaintext: string): EncryptedData {
  const iv = crypto.randomBytes(12); // 96 bits = 12 bytes para GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);

  let ciphertext = cipher.update(plaintext, "utf8", "hex");
  ciphertext += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/**
 * Descifra un EncryptedData con AES-256-GCM
 */
export function decrypt(encrypted: EncryptedData): string {
  const iv = Buffer.from(encrypted.iv, "hex");
  const authTag = Buffer.from(encrypted.authTag, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);

  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(encrypted.ciphertext, "hex", "utf8");
  plaintext += decipher.final("utf8");

  return plaintext;
}

/**
 * Cifra un objeto JSON
 */
export function encryptJSON<T extends Record<string, any>>(obj: T): EncryptedData {
  return encrypt(JSON.stringify(obj));
}

/**
 * Descifra a un objeto JSON
 */
export function decryptJSON<T extends Record<string, any>>(encrypted: EncryptedData): T {
  const plaintext = decrypt(encrypted);
  return JSON.parse(plaintext) as T;
}
