import { createServiceClient } from "@/lib/supabase";
import { decryptJSON } from "../encryption";
import { TokenExpiredError } from "../types";
import type { RappiAuthResponse } from "./types";
import { RAPPI_AUTH_BASE, RAPPI_ENDPOINTS } from "./types";

interface TokenCache {
  token: string;
  expiresAt: number;
  storeId: string;
}

const tokenCache: Record<string, TokenCache> = {};

// Renovar 24 horas antes del vencimiento (token dura 7 días)
const RENEWAL_BUFFER_MS = 24 * 60 * 60 * 1000;

export async function getRappiToken(storeId: string): Promise<string> {
  const cached = tokenCache[storeId];
  if (cached && Date.now() < cached.expiresAt - RENEWAL_BUFFER_MS) {
    return cached.token;
  }

  const supabase = createServiceClient();
  const { data: config, error } = await supabase
    .from("canal_config")
    .select("credenciales_encriptada, credenciales_iv, credenciales_auth_tag")
    .eq("store_id", storeId)
    .eq("canal_id", "rappi")
    .single();

  if (error || !config) {
    throw new Error("Rappi not configured for this store");
  }

  const creds = decryptJSON({
    ciphertext: config.credenciales_encriptada,
    iv: config.credenciales_iv,
    authTag: config.credenciales_auth_tag,
  }) as { client_id: string; client_secret: string };

  const response = await fetch(`${RAPPI_AUTH_BASE}${RAPPI_ENDPOINTS.auth}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
    }),
  });

  if (response.status === 403) {
    throw new TokenExpiredError("rappi");
  }
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Rappi auth failed: ${err}`);
  }

  const data: RappiAuthResponse = await response.json();

  tokenCache[storeId] = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    storeId,
  };

  return data.access_token;
}

export function isRappiTokenExpired(storeId: string): boolean {
  const cached = tokenCache[storeId];
  if (!cached) return true;
  return Date.now() >= cached.expiresAt - RENEWAL_BUFFER_MS;
}

export async function clearRappiToken(storeId: string): Promise<void> {
  delete tokenCache[storeId];
}
