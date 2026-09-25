import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { createServiceClient } from "@/lib/supabase";
import { encryptJSON } from "@/lib/canales/encryption";
import { logAudit, getRequestMetadata, withErrorLogging } from "@/lib/audit";
import {
  CAMPO_EXTERNAL_STORE_ID,
  CANALES_INTEGRACION_PENDIENTE,
  type CanalConfigurableId,
} from "@/lib/canales/campos";
import { credencialesValidas } from "@/lib/canales/credenciales";
import { z } from "zod";

// Fase 2 (2.3): las credenciales se validan con el MISMO schema que usa el
// flujo del canal (lib/canales/credenciales.ts, generado desde
// lib/canales/campos.ts — fuente única con la UI). Antes esta ruta exigía
// api_key/api_secret para Rappi mientras rappi/auth.ts leía
// client_id/client_secret (C5).
function allCredentialsFilled(canalId: CanalConfigurableId, credenciales: Record<string, string>): boolean {
  return credencialesValidas(canalId, credenciales);
}

// C4: el id de la tienda en la plataforma se guarda también en su columna
// (canal_config.external_store_id), que es lo que lee el flujo del canal.
function externalStoreIdDe(canalId: CanalConfigurableId, credenciales: Record<string, string>): string | undefined {
  const campo = CAMPO_EXTERNAL_STORE_ID[canalId];
  return campo ? credenciales[campo]?.trim() || undefined : undefined;
}

// D8: configurar un canal (credenciales, activar) es solo para
// storeAdmin/systemAdmin, validado aquí; el formulario es solo UX.
async function soloAdmin(storeId: string): Promise<NextResponse | null> {
  const { sessionClaims } = await auth();
  try {
    requireStoreAdmin(getAdminStatus(sessionClaims), storeId);
    return null;
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
}

const INTEGRACION_PENDIENTE = "Integración pendiente: este canal aún no se puede activar";

export const GET = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("canal_config")
    .select("id, canal_id, activo, created_at, updated_at, credenciales_encriptada")
    .eq("store_id", store_id);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  // tiene_credenciales: booleano derivado — el frontend lo usa para permitir
  // reactivar un canal sin reingresar credenciales ya guardadas (ticket
  // Trello 6a5f9b146418dc26e56d7274). Nunca se expone credenciales_encriptada
  // (ni desencriptada) en la respuesta.
  const result = (data ?? []).map(({ credenciales_encriptada, ...rest }) => ({
    ...rest,
    tiene_credenciales: !!credenciales_encriptada,
  }));

  return NextResponse.json(result);
}, { endpoint: "GET /api/canales/config" });

export const POST = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const forbidden = await soloAdmin(store_id);
  if (forbidden) return forbidden;
  const supabase = createServiceClient();

  const configSchema = z.object({
    canal_id: z.enum(["rappi", "pedidosya", "ubereats", "instagram"]),
    credenciales: z.record(z.string(), z.string()),
    activo: z.boolean().optional(),
  });

  const body = await req.json();
  const parsed = configSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { canal_id, credenciales, activo } = parsed.data;

  const wantsActive = activo === true;

  if (wantsActive && !allCredentialsFilled(canal_id, credenciales)) {
    return NextResponse.json(
      { error: "Todas las credenciales son requeridas para activar el canal" },
      { status: 422 }
    );
  }

  if (wantsActive && CANALES_INTEGRACION_PENDIENTE.includes(canal_id)) {
    return NextResponse.json({ error: INTEGRACION_PENDIENTE }, { status: 409 });
  }

  const hasCredentials = Object.values(credenciales).some(v => v.trim() !== "");

  // Sin credenciales reales, no cifrar/guardar un blob vacío: dejar las
  // columnas en null. Un ciphertext de "{}" haría que el chequeo de
  // "¿existen credenciales?" en el PATCH (más abajo) piense que sí las hay
  // sólo porque la columna no es NULL, permitiendo activar el canal sin
  // credenciales reales en un segundo guardado.
  const encryptedCreds = hasCredentials ? encryptJSON(credenciales) : null;

  const { data, error } = await supabase
    .from("canal_config")
    .insert({
      store_id,
      canal_id,
      credenciales_encriptada: encryptedCreds?.ciphertext ?? null,
      credenciales_iv: encryptedCreds?.iv ?? null,
      credenciales_auth_tag: encryptedCreds?.authTag ?? null,
      external_store_id: hasCredentials ? externalStoreIdDe(canal_id, credenciales) ?? null : null,
      activo: activo ?? false,
    })
    .select()
    .single();

  if (error) {
    console.error("[POST /api/canales/config] Error:", error);
    if (error.code === "23505") {
      return NextResponse.json({ error: "Canal ya configurado" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message || "Error interno del servidor" }, { status: 500 });
  }

  await logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "CREATE",
    entityType: "canal_config",
    entityId: data.id,
    changeDescription: `Configurado canal: ${canal_id}`,
    ipAddress: (await getRequestMetadata(req)).ipAddress,
    userAgent: (await getRequestMetadata(req)).userAgent,
    result: "success",
  });

  return NextResponse.json(
    { id: data.id, canal_id: data.canal_id, activo: data.activo },
    { status: 201 }
  );
}, { endpoint: "POST /api/canales/config" });

export const PATCH = withErrorLogging(async (req: NextRequest) => {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const forbidden = await soloAdmin(store_id);
  if (forbidden) return forbidden;
  const supabase = createServiceClient();

  const updateSchema = z.object({
    canal_id: z.enum(["rappi", "pedidosya", "ubereats", "instagram"]),
    credenciales: z.record(z.string(), z.string()).optional(),
    activo: z.boolean().optional(),
    // D7: recargo del canal sobre el precio base (%, hasta 2 decimales; la
    // columna es NUMERIC(5,2) con CHECK >= 0). Tope 100 %: un recargo mayor
    // casi seguro es un error de tipeo. Afecta al catálogo recién al
    // volver a publicarlo.
    recargo_pct: z.number().min(0).max(100).multipleOf(0.01).optional(),
  });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { canal_id, credenciales, activo, recargo_pct } = parsed.data;

  const wantsActive = activo === true;

  if (wantsActive) {
    const payloadHasRealCreds = credenciales !== undefined && Object.values(credenciales).some(v => v.trim() !== "");

    if (payloadHasRealCreds && !allCredentialsFilled(canal_id, credenciales)) {
      return NextResponse.json(
        { error: "Todas las credenciales son requeridas para activar el canal" },
        { status: 422 }
      );
    }

    if (!payloadHasRealCreds) {
      const { data: existing } = await createServiceClient()
        .from("canal_config")
        .select("credenciales_encriptada")
        .eq("store_id", store_id)
        .eq("canal_id", canal_id)
        .single();

      if (!existing?.credenciales_encriptada) {
        return NextResponse.json(
          { error: "No se puede activar el canal sin credenciales configuradas" },
          { status: 422 }
        );
      }
    }

    if (CANALES_INTEGRACION_PENDIENTE.includes(canal_id)) {
      return NextResponse.json({ error: INTEGRACION_PENDIENTE }, { status: 409 });
    }
  }

  const hasCredentialsInPayload = credenciales !== undefined && Object.values(credenciales).some(v => v.trim() !== "");

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // Sólo tocar las credenciales cifradas si el payload trae todos los campos
  // requeridos para el canal. El formulario de edición nunca precarga las
  // credenciales guardadas (no se devuelven desencriptadas por seguridad), así
  // que un simple re-guardado sin tocar esos campos envía credenciales={} — si
  // eso se cifrara y guardara igual, borraría las credenciales ya configuradas.
  // Adicionalmente, credenciales parciales (solo algunos campos) no se guardan
  // para no sobrescribir configuraciones completas con datos incompletos.
  if (hasCredentialsInPayload && credenciales && allCredentialsFilled(canal_id, credenciales)) {
    const encryptedCreds = encryptJSON(credenciales);
    updateData.credenciales_encriptada = encryptedCreds.ciphertext;
    updateData.credenciales_iv = encryptedCreds.iv;
    updateData.credenciales_auth_tag = encryptedCreds.authTag;
    updateData.external_store_id = externalStoreIdDe(canal_id, credenciales) ?? null;
  }

  if (activo !== undefined) {
    updateData.activo = activo;
  }

  if (recargo_pct !== undefined) {
    updateData.recargo_pct = recargo_pct;
  }

  const { data, error } = await supabase
    .from("canal_config")
    .update(updateData)
    .eq("store_id", store_id)
    .eq("canal_id", canal_id)
    .select()
    .single();

  if (error) {
    console.error("[PATCH /api/canales/config] Error:", error);
    return NextResponse.json({ error: error.message || "Canal no encontrado" }, { status: error.code === "PGRST116" ? 404 : 500 });
  }

  await logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "canal_config",
    entityId: data.id,
    changeDescription: `Actualizado canal: ${canal_id}`,
    ipAddress: (await getRequestMetadata(req)).ipAddress,
    userAgent: (await getRequestMetadata(req)).userAgent,
    result: "success",
  });

  return NextResponse.json({
    id: data.id,
    canal_id: data.canal_id,
    activo: data.activo,
    recargo_pct: data.recargo_pct != null ? Number(data.recargo_pct) : 0,
  });
}, { endpoint: "PATCH /api/canales/config" });
