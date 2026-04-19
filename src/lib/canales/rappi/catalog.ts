import { RAPPI_API_BASE, RAPPI_ENDPOINTS, RappiCatalogItem } from "./types";
import { getRappiToken, isRappiTokenExpired } from "./auth";

export async function syncRappiCatalog(
  storeId: string,
  storeUuid: string,
  items: RappiCatalogItem[]
): Promise<void> {
  if (isRappiTokenExpired(storeId)) {
    throw new Error("Rappi token expired");
  }

  const token = await getRappiToken(storeId);

  const chunks = chunkArray(items, 100);

  for (const chunk of chunks) {
    const response = await fetch(
      `${RAPPI_API_BASE}${RAPPI_ENDPOINTS.catalog.replace("{store_id}", storeUuid)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ products: chunk }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Failed to sync catalog: ${err}`);
    }
  }
}

export async function setRappiAvailability(
  storeId: string,
  storeUuid: string,
  items: { id: string; availability: boolean }[]
): Promise<void> {
  if (isRappiTokenExpired(storeId)) {
    throw new Error("Rappi token expired");
  }

  const token = await getRappiToken(storeId);
  const payload = items.map((item) => ({
    id: item.id,
    availability: item.availability,
  }));

  const response = await fetch(
    `${RAPPI_API_BASE}/api/v1/stores/${storeUuid}/availability`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ products: payload }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to update availability: ${err}`);
  }
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}