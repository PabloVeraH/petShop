// src/lib/audit.ts
import { createServiceClient } from "./supabase";
import { NextRequest, NextResponse } from "next/server";
import { logSecurityAlert } from "./security-alerts";

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