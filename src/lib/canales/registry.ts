/**
 * Registry de adaptadores de canales
 * Controla qué canales están disponibles (ENABLED_CHANNELS env var)
 * Nivel 1 de habilitación: instalación (redeploy required)
 */

import { IExternalChannel, CanalId, ChannelError } from "./types";
import { PosChannel } from "./pos/adapter";
import { RappiChannel } from "./rappi/adapter";
import { PedidosYaChannel } from "./pedidosya/adapter";
import { UberEatsChannel } from "./ubereats/adapter";

// Todos los adaptadores disponibles (se cargan dinámicamente según ENABLED_CHANNELS)
const ALL_ADAPTERS: Record<CanalId, IExternalChannel> = {
  pos: new PosChannel(),
  rappi: new RappiChannel(),
  pedidosya: new PedidosYaChannel(),
  ubereats: new UberEatsChannel(),
};

// Determinar qué canales están habilitados según ENABLED_CHANNELS
const getEnabledChannels = (): Set<CanalId> => {
  const enabled = new Set<CanalId>(["pos"]); // POS siempre incluido

  const envChannels = process.env.ENABLED_CHANNELS;
  if (envChannels) {
    const channelIds = envChannels
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as CanalId[];

    channelIds.forEach((id) => enabled.add(id));
  }

  return enabled;
};

const enabledChannels = getEnabledChannels();

// Crear el registry con solo los canales habilitados
export const channelRegistry: Record<CanalId, IExternalChannel> = Object.fromEntries(
  Object.entries(ALL_ADAPTERS).filter(([id]) => enabledChannels.has(id as CanalId))
) as Record<CanalId, IExternalChannel>;

/**
 * Obtener un canal específico
 * @throws ChannelError si el canal no está disponible
 */
export function getChannel(id: CanalId): IExternalChannel {
  const ch = channelRegistry[id];
  if (!ch) {
    throw new ChannelError(
      `Canal no disponible en esta instalación: ${id}`,
      404,
      id
    );
  }
  return ch;
}

/**
 * Listar IDs de canales habilitados
 */
export function getEnabledChannelIds(): CanalId[] {
  return Object.keys(channelRegistry) as CanalId[];
}

/**
 * Verificar si un canal está disponible
 */
export function isChannelAvailable(id: CanalId): boolean {
  return id in channelRegistry;
}
