// src/lib/audit.ts
import { createServiceClient } from "./supabase";
import { NextRequest, NextResponse, after } from "next/server";
import { logSecurityAlert } from "./security-alerts";
import { getStoreId } from "./auth";

export interface AuditLogInput {
  storeId: string;
  userId: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "LOGIN_FAILED" | "EXPORT" | "SETTINGS" | "BAN_USER" | "UNBAN_USER" | "AI_RECOMMENDATION" | "BACKFILL" | "CIERRE_MES";
  entityType: string;
  entityId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changeDescription?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  result?: "success" | "failure" | "partial";
  errorMessage?: string;
}

export async function logAudit(input: AuditLogInput) {
  const supabase = createServiceClient();
  
  const { error } = await supabase.from("audit_logs").insert({
    store_id: input.storeId,
    user_id: input.userId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    old_values: input.oldValues,
    new_values: input.newValues,
    change_description: input.changeDescription,
    ip_address: input.ipAddress,
    user_agent: input.userAgent,
    result: input.result || "success",
    error_message: input.errorMessage,
  });

  if (error) {
    console.error("Failed to log audit:", error);
    logSecurityAlert({
      type: "audit_log_failure",
      severity: "HIGH",
      message: `Failed to log audit: ${error.message}`,
      metadata: { entityType: input.entityType, entityId: input.entityId },
    });
  }
}

// Helper para extraer IP y UA
export function getRequestMetadata(req: NextRequest) {
  return {
    ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
    userAgent: req.headers.get("user-agent") || null,
  };
}

// Helper para comparar objetos (para old_values vs new_values)
export function getChangedFields(oldObj: any, newObj: any): string {
  const changes: string[] = [];
  for (const key in newObj) {
    if (oldObj[key] !== newObj[key]) {
      changes.push(`${key}: ${oldObj[key]} → ${newObj[key]}`);
    }
  }
  return changes.join(", ");
}

export interface ErrorLogInput {
  storeId?: string;
  userId?: string;
  errorCode?: string;
  errorMessage: string;
  stackTrace?: string;
  context?: Record<string, unknown>;
  severity?: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  endpoint?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function logError(input: ErrorLogInput) {
  const supabase = createServiceClient();

  const { error } = await supabase.from("error_logs").insert({
    store_id: input.storeId ?? null,
    user_id: input.userId ?? null,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage,
    stack_trace: input.stackTrace ?? null,
    context: input.context ?? null,
    severity: input.severity ?? "ERROR",
    endpoint: input.endpoint ?? null,
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null,
  });

  if (error) {
    console.error("[logError] Failed to save error log:", error.message);
  }
}

export async function handleRouteError(
  err: unknown,
  ctx: { storeId?: string; userId?: string; endpoint: string; req?: NextRequest }
): Promise<NextResponse> {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  const meta = ctx.req ? getRequestMetadata(ctx.req) : {};

  await logError({
    storeId: ctx.storeId,
    userId: ctx.userId,
    errorMessage: message,
    stackTrace: stack,
    severity: "ERROR",
    endpoint: ctx.endpoint,
    ...meta,
  });

  return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
}

// Deriva el contexto (storeId/userId) de forma best-effort para el log de
// errores. No debe nunca lanzar: si getStoreId() falla, el log se hace igual
// con store_id null (visible solo para systemAdmin sin filtro de tienda).
async function bestEffortErrorContext(): Promise<Pick<ErrorLogInput, "storeId" | "userId">> {
  try {
    const ctx = await getStoreId();
    if (!ctx) return {};
    return { storeId: ctx.storeId, userId: ctx.userId };
  } catch {
    return {};
  }
}

/**
 * Envuelve un Route Handler para registrar en `error_logs` todo error 500
 * real: tanto excepciones lanzadas como respuestas con status >= 500
 * devueltas inline. Ticket Trello 6a77eec7a32c85d594ee7a62 — los 500 reales
 * no llegaban a la grilla Admin > Auditoría > "Errores de sistema" porque
 * ningún endpoint invocaba logError()/handleRouteError().
 *
 * - Excepción lanzada → logError() + respuesta 500 genérica (mismo contrato
 *   de error que Next.js, sin filtrar detalles internos).
 * - Respuesta con status >= 500 → logError() y la respuesta se devuelve
 *   intacta (no cambia el contrato HTTP existente de la ruta).
 * - Resto → pasa directo, sin costo.
 *
 * El log se agenda vía after() de next/server (post-response): la plataforma
 * espera a que el callback termine (waitUntil) tras responder, en vez de un
 * fire-and-forget puro que puede quedar congelado a mitad de ejecución en
 * serverless y dejar el INSERT sin completarse — exactamente el mismo patrón
 * (y el mismo riesgo, ya materializado una vez en ticket Trello
 * 6a77e779358cdccca29dc3e3) que crearAsiento() en ventas/notas-credito. Aquí
 * el riesgo es peor: si el log de error no persiste, el síntoma es
 * indistinguible del bug original de este ticket (grilla vacía pese a 500
 * reales). logError() nunca debe lanzar ni bloquear el callback: se resuelve
 * con .catch(() => {}) igual que antes.
 */
export function withErrorLogging<TArgs extends unknown[], TRes extends Response>(
  handler: (...args: TArgs) => Promise<TRes>,
  options: { endpoint: string }
): (...args: TArgs) => Promise<TRes> {
  return async (...args) => {
    const req = args.find((a): a is NextRequest => a instanceof NextRequest);
    const meta = req ? getRequestMetadata(req) : {};
    try {
      const res = await handler(...args);
      if (res.status >= 500) {
        after(async () => {
          const ctx = await bestEffortErrorContext();
          await logError({
            ...ctx,
            ...meta,
            endpoint: options.endpoint,
            errorMessage: `HTTP ${res.status} en ${options.endpoint}`,
            severity: "ERROR",
          }).catch(() => {});
        });
      }
      return res;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stackTrace = err instanceof Error ? err.stack : undefined;
      after(async () => {
        const ctx = await bestEffortErrorContext();
        await logError({
          ...ctx,
          ...meta,
          endpoint: options.endpoint,
          errorMessage: message,
          stackTrace,
          severity: "ERROR",
        }).catch(() => {});
      });
      return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 }) as unknown as TRes;
    }
  };
}
