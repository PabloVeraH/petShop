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
    canal_id: z.enum(["rappi", "pedidosya", "ubereats"]),
    credenciales: z.record(z.string(), z.unknown()),
  });

  const body = await req.json();
  const parsed = configSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { canal_id, credenciales } = parsed.data;

  const encryptedCreds = encryptJSON(credenciales);

  const { data, error } = await supabase
    .from("canal_config")
    .insert({
      store_id,
      canal_id,
      credenciales_encriptada: encryptedCreds.ciphertext,
      credenciales_iv: encryptedCreds.iv,
      credenciales_auth_tag: encryptedCreds.authTag,
      activo: true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Canal ya configurado" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
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
    canal_id: z.enum(["rappi", "pedidosya", "ubereats"]),
    credenciales: z.record(z.string(), z.unknown()).optional(),
    activo: z.boolean().optional(),
  });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { canal_id, credenciales, activo } = parsed.data;

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
    return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });
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
