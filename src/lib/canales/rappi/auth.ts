import { createServiceClient } from "@/lib/supabase";
import { decryptJSON } from "../encryption";
import { TokenExpiredError } from "../types";
import type { RappiAuthResponse } from "./types";

interface TokenCache {
  token: string;
  expiresAt: number;
  storeId: string;
}

const tokenCache: Record<string, TokenCache> = {};

export async function getRappiToken(storeId: string): Promise<string> {
  const cached = tokenCache[storeId];
  if (cached && Date.now() < cached.expiresAt - 60000) {
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

  const encrypted = {
    ciphertext: config.credenciales_encriptada,
    iv: config.credenciales_iv,
    authTag: config.credenciales_auth_tag,
  };

  const creds = decryptJSON(encrypted);
  const { client_id, client_secret } = creds as { client_id: string; client_secret: string };

  const response = await fetch(`https://api.rappi.com/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id,
      client_secret,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Rappi auth failed: ${err}`);
  }

  const data: RappiAuthResponse = await response.json();

  tokenCache[storeId] = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    storeId,
  };

  return data.access_token;
}

export function isRappiTokenExpired(storeId: string): boolean {
  const cached = tokenCache[storeId];
  if (!cached) return true;
  return Date.now() >= cached.expiresAt;
}

export async function clearRappiToken(storeId: string): Promise<void> {
  delete tokenCache[storeId];
}