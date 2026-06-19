import { auth } from "@clerk/nextjs/server";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { logAudit, getRequestMetadata } from "@/lib/audit";
import { SettingsUpdateSchema } from "@/lib/validation";

export async function GET() {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  try { requireStoreAdmin(admin); } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("stores")
    .select("id, name, rut, address, phone, email, whatsapp_enabled, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_webhook_verify_token, email_reminder_enabled, email_reminder_dias_aviso, resend_from_email, fidelizacion_niveles, ciudad, lat, lon, direccion")
    .eq("id", store_id)
    .single();

  if (error) return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });

  return NextResponse.json({
    ...data,
    whatsapp_access_token: data?.whatsapp_access_token ? "••••••••" : "",
    whatsapp_webhook_verify_token: data?.whatsapp_webhook_verify_token ? "••••••••" : "",
  });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;

  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);
  try { requireStoreAdmin(admin); } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();

  const body = await req.json();
  const parsed = SettingsUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const {
    name,
    rut,
    address,
    phone,
    email,
    whatsapp_enabled,
    whatsapp_phone_number_id,
    whatsapp_access_token,
    whatsapp_webhook_verify_token,
    email_reminder_enabled,
    email_reminder_dias_aviso,
    resend_from_email,
    fidelizacion_niveles,
    ciudad,
    lat,
    lon,
    direccion,
  } = parsed.data;

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) updateData.name = name;
  if (rut !== undefined) updateData.rut = rut;
  if (address !== undefined) updateData.address = address;
  if (phone !== undefined) updateData.phone = phone;
  if (email !== undefined) updateData.email = email;
  if (whatsapp_enabled !== undefined) updateData.whatsapp_enabled = whatsapp_enabled;
  if (whatsapp_phone_number_id !== undefined) updateData.whatsapp_phone_number_id = whatsapp_phone_number_id;
  if (whatsapp_webhook_verify_token !== undefined && whatsapp_webhook_verify_token !== "••••••••") {
    updateData.whatsapp_webhook_verify_token = whatsapp_webhook_verify_token;
  }
  if (whatsapp_access_token !== undefined && whatsapp_access_token !== "••••••••") {
    updateData.whatsapp_access_token = whatsapp_access_token;
  }
  if (email_reminder_enabled !== undefined) updateData.email_reminder_enabled = email_reminder_enabled;
  if (email_reminder_dias_aviso !== undefined) updateData.email_reminder_dias_aviso = email_reminder_dias_aviso;
  if (resend_from_email !== undefined) updateData.resend_from_email = resend_from_email;
  if (fidelizacion_niveles !== undefined) updateData.fidelizacion_niveles = fidelizacion_niveles;
  if (ciudad !== undefined) updateData.ciudad = ciudad;
  if (lat !== undefined) updateData.lat = lat;
  if (lon !== undefined) updateData.lon = lon;
  if (direccion !== undefined) updateData.direccion = direccion;

  const { data: originalStore } = await supabase
    .from("stores")
    .select("*")
    .eq("id", store_id)
    .single();

  const auditOldValues = originalStore ?? {};

  const { ipAddress, userAgent } = await getRequestMetadata(req);

  const { data, error } = await supabase
    .from("stores")
    .update(updateData)
    .eq("id", store_id)
    .select()
    .single();

  if (error) {
    await logAudit({
      storeId: store_id,
      userId: ctx.userId,
      action: "UPDATE",
      entityType: "settings",
      entityId: store_id,
      oldValues: auditOldValues,
      newValues: updateData,
      ipAddress,
      userAgent,
      result: "failure",
      errorMessage: error.message,
    });
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }

  await logAudit({
    storeId: store_id,
    userId: ctx.userId,
    action: "UPDATE",
    entityType: "settings",
    entityId: store_id,
    oldValues: auditOldValues,
    newValues: data,
    changeDescription: "Configuración de tienda actualizada",
    ipAddress,
    userAgent,
    result: "success",
  });

  return NextResponse.json(data);
}