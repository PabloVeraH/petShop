import { createServiceClient } from "@/lib/supabase";
import { decryptJSON } from "../encryption";
import { PEDIDOSYA_AUTH_BASE, PEDIDOSYA_ENDPOINTS } from "./types";
import type { PedidosYaAuthResponse } from "./types";

interface TokenCache {
  token: string;
  expiresAt: number;
  storeId: string;
}

const tokenCache: Record<string, TokenCache> = {};

// Token válido por 2 horas (7200000 ms) - renovar 5 min antes
const TOKEN_EXPIRY_MS = 2 * 60 * 60 * 1000;
const RENEWAL_BUFFER_MS = 5 * 60 * 1000;

export async function getPedidosYaToken(storeId: string): Promise<string> {
  const cached = tokenCache[storeId];
  if (cached && Date.now() < cached.expiresAt - RENEWAL_BUFFER_MS) {
    return cached.token;
  }

  const supabase = createServiceClient();
  const { data: config, error } = await supabase
    .from("canal_config")
    .select("credenciales_encriptada, credenciales_iv, credenciales_auth_tag")
    .eq("store_id", storeId)
    .eq("canal_id", "pedidosya")
    .single();

  if (error || !config) {
    throw new Error("PedidosYa not configured for this store");
  }

  const encrypted = {
    ciphertext: config.credenciales_encriptada,
    iv: config.credenciales_iv,
    authTag: config.credenciales_auth_tag,
  };

  const creds = decryptJSON(encrypted);
  const { client_id, client_secret } = creds as { client_id: string; client_secret: string };

  // Usar el endpoint oficial de PedidosYa Partner API
  const response = await fetch(`${PEDIDOSYA_AUTH_BASE}${PEDIDOSYA_ENDPOINTS.auth}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id,
      client_secret,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`PedidosYa auth failed: ${err}`);
  }

  const data: PedidosYaAuthResponse = await response.json();

  // Token expira en 2 horas según docs
  const expiresIn = data.expires_in * 1000 || TOKEN_EXPIRY_MS;
  tokenCache[storeId] = {
    token: data.access_token,
    expiresAt: Date.now() + expiresIn,
    storeId,
  };

  return data.access_token;
}

export function isPedidosYaTokenExpired(storeId: string): boolean {
  const cached = tokenCache[storeId];
  if (!cached) return true;
  return Date.now() >= cached.expiresAt - RENEWAL_BUFFER_MS;
}

export async function clearPedidosYaToken(storeId: string): Promise<void> {
  delete tokenCache[storeId];
}