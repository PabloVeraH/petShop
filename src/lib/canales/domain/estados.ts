import { ESTADOS_ORDEN, type EstadoOrden } from "./types";

// Máquina de estados de canal_ordenes (§4.3). Toda transición en BD se hace
// con `UPDATE ... WHERE estado IN (origenesValidos(destino))`: 0 filas =
// transición inválida o carrera perdida → no se repiten efectos.
//
//   pending ──▶ processing ──▶ accepted ──▶ ready ──▶ picked_up ──▶ delivered
//                  │               │         │
//                  ├─▶ rejected    └────┬────┘
//                  ├─▶ failed ──▶ pending (reintento por admin)
//                  └─▶ pending (reintento tras error transitorio)
//   pending ──▶ cancelled | expired          accepted/ready ──▶ cancelled
const TRANSICIONES: Record<EstadoOrden, readonly EstadoOrden[]> = {
  pending: ["processing", "cancelled", "expired"],
  processing: ["accepted", "rejected", "failed", "pending"],
  accepted: ["ready", "cancelled"],
  ready: ["picked_up", "cancelled"],
  picked_up: ["delivered"],
  delivered: [],
  rejected: [],
  failed: ["pending"],
  cancelled: [],
  expired: [],
};

export function esEstadoOrden(valor: unknown): valor is EstadoOrden {
  return typeof valor === "string" && (ESTADOS_ORDEN as readonly string[]).includes(valor);
}

export function puedeTransicionar(desde: EstadoOrden, hacia: EstadoOrden): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

// Estados desde los que se puede llegar a `destino` (para el WHERE del UPDATE).
export function origenesValidos(destino: EstadoOrden): EstadoOrden[] {
  return ESTADOS_ORDEN.filter((e) => TRANSICIONES[e].includes(destino));
}

export function esTerminal(estado: EstadoOrden): boolean {
  return TRANSICIONES[estado].length === 0;
}
