// Campos de credenciales por canal — FUENTE ÚNICA para la UI de
// configuración (canales/[canal]/page.tsx) y para los schemas Zod del
// servidor (adapters/*/schemas.ts, infrastructure/credenciales.ts).
// Reemplaza a REQUIRED_CREDENTIAL_FIELDS de la ruta de config (C5).
// Sin dependencias de servidor: se importa desde un Client Component.

export type CanalConfigurableId = "rappi" | "pedidosya" | "ubereats" | "instagram";

export interface CampoCredencial {
  key: string;
  label: string;
  type: "text" | "password";
  placeholder: string;
}

export const CAMPOS_CREDENCIALES: Record<CanalConfigurableId, CampoCredencial[]> = {
  // Rappi (API de integraciones de restaurantes): client_id/client_secret del
  // dev-portal; store_id = id de la tienda en Rappi (se guarda también en
  // canal_config.external_store_id); webhook_secret = secreto devuelto por
  // Rappi al registrar el webhook. Rappi entrega un secreto POR EVENTO; si
  // difieren, se pueden agregar claves webhook_secret_<EVENTO> (ver
  // adapters/rappi/schemas.ts).
  rappi: [
    { key: "client_id", label: "Client ID", type: "text", placeholder: "client_id del portal de Rappi" },
    { key: "client_secret", label: "Client Secret", type: "password", placeholder: "client_secret" },
    { key: "store_id", label: "ID de tienda en Rappi", type: "text", placeholder: "900105814" },
    { key: "webhook_secret", label: "Webhook Secret", type: "password", placeholder: "secreto del webhook" },
  ],
  pedidosya: [
    { key: "client_id", label: "Client ID", type: "text", placeholder: "pedidosya_cliente_123" },
    { key: "client_secret", label: "Client Secret", type: "password", placeholder: "py_secret_..." },
    { key: "business_id", label: "Business ID", type: "text", placeholder: "123456" },
  ],
  ubereats: [
    { key: "client_id", label: "Client ID", type: "text", placeholder: "..." },
    { key: "client_secret", label: "Client Secret", type: "password", placeholder: "..." },
    { key: "store_uuid", label: "Store UUID", type: "text", placeholder: "..." },
  ],
  instagram: [
    { key: "app_id", label: "App ID", type: "text", placeholder: "123456789" },
    { key: "app_secret", label: "App Secret", type: "password", placeholder: "abc123..." },
    { key: "ig_user_id", label: "IG User ID", type: "text", placeholder: "17841..." },
    { key: "access_token", label: "Access Token", type: "password", placeholder: "EAAB..." },
  ],
};

// Campo de las credenciales que identifica la tienda en la plataforma; la
// ruta de config lo copia a canal_config.external_store_id (C4).
export const CAMPO_EXTERNAL_STORE_ID: Partial<Record<CanalConfigurableId, string>> = {
  rappi: "store_id",
  pedidosya: "business_id",
  ubereats: "store_uuid",
};

// 2.7: sin documentación oficial ni credenciales reales, sus adaptadores son
// placeholders (C20). Se pueden guardar credenciales pero no activar.
export const CANALES_INTEGRACION_PENDIENTE: readonly CanalConfigurableId[] = ["pedidosya", "ubereats"];

export function esCanalConfigurable(valor: unknown): valor is CanalConfigurableId {
  return typeof valor === "string" && valor in CAMPOS_CREDENCIALES;
}
