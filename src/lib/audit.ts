// src/lib/audit.ts
import { createServiceClient } from "./supabase";
import { NextRequest } from "next/server";
import { logSecurityAlert } from "./security-alerts";

export interface AuditLogInput {
  storeId: string;
  userId: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "LOGIN_FAILED" | "EXPORT" | "SETTINGS" | "BAN_USER" | "UNBAN_USER";
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