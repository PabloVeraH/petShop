import type { z } from "zod";
import type { CanalExternoId, EventoCanal, MotivoRechazo } from "../domain/types";

// Puerto de adaptador de canal (§5.2). Reemplaza a IExternalChannel para el
// flujo nuevo (webhook de la Fase 2; aceptación/outbox en la Fase 3). Los
// adaptadores SOLO traducen y hablan HTTP: la lógica de negocio vive en
// application/ y domain/ (D9).

// Contexto de una tienda en un canal, ya descifrado y validado por Zod
// (infrastructure/context.ts). Nunca se loguea ni se devuelve al cliente.
export interface ChannelContext {
  storeId: string;
  canalId: CanalExternoId;
  externalStoreId: string | null;
  credentials: Record<string, string>;
  recargoPct: number;
  comisionPct: number;
}

export interface WebhookRequest {
  headers: Headers;
  rawBody: string;
  // Algunas plataformas (Rappi) registran una URL por evento: el evento
  // llega en la URL (?evento=), no en el cuerpo.
  evento: string | null;
}

export interface ItemCatalogo {
  sku: string;
  nombre: string;
  descripcion?: string;
  precioBruto: number;
  categoria?: string;
  imagenUrl?: string | null;
}

export interface ItemDisponibilidad {
  sku: string;
  disponible: boolean;
  cantidad?: number; // solo availabilityMode "quantity"
}

export interface ChannelAdapter {
  readonly id: CanalExternoId;
  readonly capabilities: {
    availabilityMode: "toggle" | "quantity";
    supportsReadyForPickup: boolean;
    acceptanceWindowMin: number;
    // true → el evento viene en la URL (?evento=...), no en el cuerpo.
    eventoEnUrl: boolean;
  };
  readonly credentialsSchema: z.ZodType<Record<string, string>>;
  // Fase 6 (checklist de salida, 6.2): eventos cuyo webhook hay que
  // registrar en la plataforma (si eventoEnUrl, una URL por evento) y
  // nombres de las variables de entorno obligatorias en producción.
  readonly eventosWebhook?: readonly string[];
  readonly variablesProduccion?: { apiBase: string; authBase: string };

  verifyWebhook(req: WebhookRequest, ctx: ChannelContext, ahoraMs?: number): boolean;
  // Lanza PayloadInvalidoError si el evento o el cuerpo no son válidos.
  parseEvent(req: WebhookRequest): EventoCanal;
  pingResponse?(): { status: number; body: unknown };

  confirmOrder(ctx: ChannelContext, externalOrderId: string): Promise<void>;
  rejectOrder(ctx: ChannelContext, externalOrderId: string, motivo: MotivoRechazo): Promise<void>;
  markReady(ctx: ChannelContext, externalOrderId: string): Promise<void>;
  pushCatalog(ctx: ChannelContext, items: ItemCatalogo[]): Promise<void>;
  pushAvailability(ctx: ChannelContext, items: ItemDisponibilidad[]): Promise<void>;
}

export class PayloadInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadInvalidoError";
  }
}

// Error de una llamada saliente a la plataforma. El mensaje nunca incluye
// credenciales ni tokens (se guarda en canal_outbox.last_error).
export class PlataformaError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "PlataformaError";
  }
}
