import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJSON } from "../encryption";
import type { CanalExternoId } from "../domain/types";
import type { ChannelAdapter, ChannelContext } from "../adapters/port";

export class CanalNoConfiguradoError extends Error {
  constructor() {
    super("Canal no configurado o inactivo");
    this.name = "CanalNoConfiguradoError";
  }
}

// Credenciales guardadas que no descifran o no cumplen el schema del
// adaptador (ej. guardadas con los campos anteriores de Rappi). El mensaje no
// incluye valores.
export class CredencialesInvalidasError extends Error {
  constructor(detalle: string) {
    super(`Credenciales del canal inválidas: ${detalle}`);
    this.name = "CredencialesInvalidasError";
  }
}

// Carga el contexto de una tienda en un canal (2.3 — resuelve C4: antes las
// llamadas al adaptador pasaban externalStoreId "" y credentials {}).
// Tenant-scoped: filtra por store_id; una tienda sin fila activa → error.
// Capas de habilitación verificadas aquí:
//   - canales_externos.habilitado (global, por canal)
//   - canal_config.activo (por tienda)
// (la capa de despliegue — ENABLED_CHANNELS — la aplica adapters/registry.ts).
export async function loadChannelContext(
  supabase: SupabaseClient,
  storeId: string,
  canalId: CanalExternoId,
  adapter: ChannelAdapter
): Promise<ChannelContext> {
  const { data: canal } = await supabase
    .from("canales_externos")
    .select("habilitado")
    .eq("id", canalId)
    .maybeSingle();
  if (!canal?.habilitado) throw new CanalNoConfiguradoError();

  const { data: config, error } = await supabase
    .from("canal_config")
    .select("external_store_id, comision_pct, recargo_pct, credenciales_encriptada, credenciales_iv, credenciales_auth_tag")
    .eq("store_id", storeId)
    .eq("canal_id", canalId)
    .eq("activo", true)
    .maybeSingle();
  if (error || !config) throw new CanalNoConfiguradoError();

  if (!config.credenciales_encriptada || !config.credenciales_iv || !config.credenciales_auth_tag) {
    throw new CredencialesInvalidasError("sin credenciales guardadas");
  }

  let crudas: unknown;
  try {
    crudas = decryptJSON({
      ciphertext: config.credenciales_encriptada,
      iv: config.credenciales_iv,
      authTag: config.credenciales_auth_tag,
    });
  } catch {
    throw new CredencialesInvalidasError("no se pudieron descifrar");
  }

  const parsed = adapter.credentialsSchema.safeParse(crudas);
  if (!parsed.success) {
    const campos = parsed.error.issues.map((i) => i.path.join(".")).filter(Boolean).join(", ");
    throw new CredencialesInvalidasError(campos ? `revisar ${campos}` : "formato inválido");
  }

  return {
    storeId,
    canalId,
    externalStoreId: config.external_store_id ?? null,
    credentials: parsed.data,
    recargoPct: Number(config.recargo_pct ?? 0),
    comisionPct: Number(config.comision_pct ?? 0),
  };
}
