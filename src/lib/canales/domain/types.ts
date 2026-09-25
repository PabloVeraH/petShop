// Tipos del dominio de canales externos (Fase 2, §5.1–5.2 de
// docs/canales-stock/stock_canales_externos.md). Sin I/O: no importa
// Supabase, Next ni fetch.

export const CANALES_EXTERNOS = ["rappi", "pedidosya", "ubereats"] as const;
export type CanalExternoId = (typeof CANALES_EXTERNOS)[number];

// userId de auditoría para acciones automáticas de los canales (sin sesión).
export const USUARIO_SISTEMA = "sistema:canales";

export function esCanalExterno(valor: unknown): valor is CanalExternoId {
  return typeof valor === "string" && (CANALES_EXTERNOS as readonly string[]).includes(valor);
}

// Estados de canal_ordenes (§4.3). Mismo conjunto que el CHECK
// canal_ordenes_estado_check de migrations/079.
export const ESTADOS_ORDEN = [
  "pending",
  "processing",
  "accepted",
  "ready",
  "picked_up",
  "delivered",
  "rejected",
  "failed",
  "cancelled",
  "expired",
] as const;
export type EstadoOrden = (typeof ESTADOS_ORDEN)[number];

// Línea de una orden ya traducida por el adaptador. Precio bruto (IVA
// incluido, AGENTS.md §23.3) y unitario, tal como lo cobró la plataforma.
export interface ItemOrden {
  sku: string;
  nombre?: string;
  cantidad: number;
  precioUnitarioBruto: number;
}

export interface OrdenNormalizada {
  externalOrderId: string;
  // Identificadores de la tienda en la plataforma que trae el evento (para
  // verificar que corresponde a la tienda configurada). Vacío si no viene.
  externalStoreIds: string[];
  items: ItemOrden[];
  totalBruto: number;
  creadaEn: string | null;
}

// Motivos de rechazo independientes de la plataforma; cada adaptador los
// traduce a su código (ej. Rappi cancel_type).
export type MotivoRechazo = "ITEM_NOT_FOUND" | "ITEM_OUT_OF_STOCK" | "STORE_CLOSED" | "OTHER";

export type EventoCanal =
  | { tipo: "orden_creada"; orden: OrdenNormalizada }
  | { tipo: "orden_cancelada"; externalOrderId: string; externalStoreIds: string[]; motivo?: string }
  | { tipo: "estado_cambiado"; externalOrderId: string; externalStoreIds: string[]; estadoExterno: string }
  | { tipo: "ping" }
  | { tipo: "menu_aprobado" }
  | { tipo: "menu_rechazado"; detalle?: string }
  | { tipo: "ignorado"; tipoExterno: string };
