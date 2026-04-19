import { RAPPI_API_BASE } from "./types";
import type { RappiMenuItem, RappiMenuPayload, RappiStoreInfo } from "./types";
import { getRappiToken } from "./auth";

function rappiHeaders(token: string): Record<string, string> {
  return {
    "x-authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

// Listar tiendas — GET /stores-pa
// Devuelve integrationId (requerido para menú y disponibilidad) y rappiId.
export async function getRappiStores(storeId: string): Promise<RappiStoreInfo[]> {
  const token = await getRappiToken(storeId);

  const response = await fetch(
    `${RAPPI_API_BASE}/api/v2/restaurants-integrations-public-api/stores-pa`,
    {
      method: "GET",
      headers: rappiHeaders(token),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to get Rappi stores: ${response.status} ${err}`);
  }

  return response.json();
}

// Sincronizar menú completo — POST /menu
// Requiere estructura con SKU, categoría y descripción por producto.
// Rappi inicia revisión manual (24–72 h) tras cada envío.
export async function syncRappiCatalog(
  storeId: string,
  storeIntegrationId: string,
  items: RappiMenuItem[]
): Promise<void> {
  const token = await getRappiToken(storeId);
  const payload: RappiMenuPayload = { storeId: storeIntegrationId, items };

  const response = await fetch(
    `${RAPPI_API_BASE}/api/v2/restaurants-integrations-public-api/menu`,
    {
      method: "POST",
      headers: rappiHeaders(token),
      body: JSON.stringify(payload),
    }
  );

  if (response.status === 424) {
    const err = await response.json();
    throw new Error(`Menu validation failed: ${JSON.stringify(err)}`);
  }
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to sync menu: ${response.status} ${err}`);
  }
}

// Verificar estado de aprobación del menú — GET /menu/approved/{storeId}
export async function checkRappiMenuApproval(
  storeId: string,
  storeIntegrationId: string
): Promise<unknown> {
  const token = await getRappiToken(storeId);

  const response = await fetch(
    `${RAPPI_API_BASE}/api/v2/restaurants-integrations-public-api/menu/approved/${storeIntegrationId}`,
    {
      method: "GET",
      headers: rappiHeaders(token),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to check menu approval: ${response.status} ${err}`);
  }

  return response.json();
}

// Actualizar disponibilidad de productos — PUT /availability/stores/items
// items: array de { sku, activo }. Los SKUs deben coincidir con los del menú enviado.
export async function setRappiAvailability(
  storeId: string,
  storeIntegrationId: string,
  items: { sku: string; activo: boolean }[]
): Promise<void> {
  const token = await getRappiToken(storeId);

  const turnOn  = items.filter(i => i.activo).map(i => i.sku);
  const turnOff = items.filter(i => !i.activo).map(i => i.sku);

  const payload = [{
    store_integration_id: storeIntegrationId,
    items: { turn_on: turnOn, turn_off: turnOff },
  }];

  const response = await fetch(
    `${RAPPI_API_BASE}/api/v2/restaurants-integrations-public-api/availability/stores/items`,
    {
      method: "PUT",
      headers: rappiHeaders(token),
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to update availability: ${response.status} ${err}`);
  }
}
