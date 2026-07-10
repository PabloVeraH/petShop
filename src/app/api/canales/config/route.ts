import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { encryptJSON, decryptJSON } from "@/lib/canales/encryption";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { z } from "zod";

const REQUIRED_CREDENTIAL_FIELDS: Record<string, string[]> = {
  rappi: ["api_key", "api_secret", "store_id", "webhook_secret"],
  pedidosya: ["client_id", "client_secret", "business_id"],
  ubereats: ["client_id", "client_secret", "store_uuid"],
  instagram: ["app_id", "app_secret", "ig_user_id", "access_token"],
};

function allCredentialsFilled(canalId: string, credenciales: Record<string, string>): boolean {
  const required = REQUIRED_CREDENTIAL_FIELDS[canalId];
  if (!required) return false;
  return required.every((key) => credenciales[key] && credenciales[key].trim() !== "");
}

export async function GET(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("canal_config")
    .select("id, canal_id, activo, created_at, updated_at")
    .eq("store_id", store_id);

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
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
}

export async function PATCH(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const updateSchema = z.object({
    canal_id: z.enum(["rappi", "pedidosya", "ubereats", "instagram"]),
    credenciales: z.record(z.string(), z.string()).optional(),
    activo: z.boolean().optional(),
  });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { canal_id, credenciales, activo } = parsed.data;

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
  }

  if (activo !== undefined) {
    updateData.activo = activo;
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

  return NextResponse.json({ id: data.id, canal_id: data.canal_id, activo: data.activo });
}
