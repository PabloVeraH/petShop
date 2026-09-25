import { esCanalExterno, type CanalExternoId } from "../domain/types";
import type { ChannelAdapter } from "./port";
import { RappiAdapter } from "./rappi/adapter";

// Registry del flujo nuevo (§5.1). Primera capa de habilitación: el canal
// debe tener adaptador implementado Y estar en ENABLED_CHANNELS (despliegue).
// Las otras capas (canales_externos.habilitado global, canal_config.activo por
// tienda) las valida infrastructure/context.ts.
//
// src/lib/canales/registry.ts (IExternalChannel, heredado) ya no tiene
// llamadores de producción desde la Fase 4 (POST /api/canales/catalog pasó a
// la outbox); solo lo usan sus tests. Eliminarlo es limpieza pendiente.

// 2.7: PedidosYa y UberEats no tienen adaptador — sus implementaciones
// anteriores son placeholders con endpoints que no coinciden con la
// documentación oficial (C20). "Integración pendiente".
const ADAPTADORES: Partial<Record<CanalExternoId, ChannelAdapter>> = {
  rappi: new RappiAdapter(),
};

export function canalImplementado(canal: CanalExternoId): boolean {
  return canal in ADAPTADORES;
}

// Se lee en cada llamada (no al importar) para que un cambio de entorno en
// tests o entre despliegues no quede congelado en el módulo.
export function canalHabilitadoEnDespliegue(canal: CanalExternoId): boolean {
  const lista = (process.env.ENABLED_CHANNELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return lista.includes(canal);
}

// Adaptador del canal si está implementado y habilitado en el despliegue; si
// no, null (el llamador responde "canal no disponible").
export function obtenerAdaptador(canal: unknown): ChannelAdapter | null {
  if (!esCanalExterno(canal)) return null;
  if (!canalHabilitadoEnDespliegue(canal)) return null;
  return ADAPTADORES[canal] ?? null;
}

// Para la suite de contrato: todos los adaptadores implementados.
export function adaptadoresImplementados(): ChannelAdapter[] {
  return Object.values(ADAPTADORES).filter((a): a is ChannelAdapter => !!a);
}
