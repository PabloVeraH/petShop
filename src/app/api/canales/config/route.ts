import { NextRequest, NextResponse } from "next/server";
import { getStoreId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { encryptJSON, decryptJSON } from "@/lib/canales/encryption";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { z } from "zod";

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
    credenciales: z.record(z.string(), z.unknown()),
    activo: z.boolean().optional(),
  });

  const body = await req.json();
  const parsed = configSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { canal_id, credenciales, activo } = parsed.data;

  const hasCredentials = Object.keys(credenciales).some(k => credenciales[k] !== "");
  const wantsActive = activo === true;

  if (wantsActive && !hasCredentials) {
    return NextResponse.json(
      { error: "No se puede activar el canal sin ingresar credenciales" },
      { status: 422 }
    );
  }

  const encryptedCreds = encryptJSON(credenciales);

  const { data, error } = await supabase
    .from("canal_config")
    .insert({
      store_id,
      canal_id,
      credenciales_encriptada: encryptedCreds.ciphertext,
      credenciales_iv: encryptedCreds.iv,
      credenciales_auth_tag: encryptedCreds.authTag,
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
    credenciales: z.record(z.string(), z.unknown()).optional(),
    activo: z.boolean().optional(),
  });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { canal_id, credenciales, activo } = parsed.data;

  const wantsActive = activo === true;
  const hasCredentialsInPayload = credenciales !== undefined && Object.keys(credenciales).some(k => credenciales[k] !== "");

  if (wantsActive && !hasCredentialsInPayload) {
    const supabaseCheck = createServiceClient();
    const { data: existing } = await supabaseCheck
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

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (credenciales) {
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
