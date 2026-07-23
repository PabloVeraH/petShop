import { requireSystemAdminConsistent, getAdminStatus } from "@/lib/admin-check";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { AiConfigUpdateSchema } from "@/lib/validation";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest) {
  // 1. Auth — solo systemAdmin
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  try {
    await requireSystemAdminConsistent(admin);
  } catch {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  // 2. Validar body
  const body = await req.json().catch(() => ({}));
  const parsed = AiConfigUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { store_id, openrouter_model } = parsed.data;

  // 3. Actualizar modelo en la base de datos
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("stores")
    .update({ openrouter_model })
    .eq("id", store_id);

  if (error) {
    return NextResponse.json({ error: "Error al actualizar configuración" }, { status: 500 });
  }

  // 4. Audit log (fire-and-forget)
  const { ipAddress, userAgent } = await getRequestMetadata(req);
  const userId = admin?.userId || "unknown";
  
  logAudit({
    storeId: store_id,
    userId,
    action: "SETTINGS",
    entityType: "ai_config",
    newValues: { openrouter_model },
    changeDescription: `Configuración de IA actualizada: modelo ${openrouter_model}`,
    ipAddress,
    userAgent,
    result: "success",
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}