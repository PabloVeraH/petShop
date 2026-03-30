import { getStoreId } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET() {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("stores")
    .select("id, name, rut, address, phone, email, whatsapp_enabled, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_webhook_verify_token")
    .eq("id", store_id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Mask access token for security
  return NextResponse.json({
    ...data,
    whatsapp_access_token: data?.whatsapp_access_token ? "••••••••" : "",
  });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getStoreId();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { storeId: store_id } = ctx;
  const supabase = createServiceClient();

  const body = await req.json();

  // Allowlist of fields that store admins are permitted to update
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
  } = body;

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) updateData.name = name;
  if (rut !== undefined) updateData.rut = rut;
  if (address !== undefined) updateData.address = address;
  if (phone !== undefined) updateData.phone = phone;
  if (email !== undefined) updateData.email = email;
  if (whatsapp_enabled !== undefined) updateData.whatsapp_enabled = whatsapp_enabled;
  if (whatsapp_phone_number_id !== undefined) updateData.whatsapp_phone_number_id = whatsapp_phone_number_id;
  if (whatsapp_webhook_verify_token !== undefined) updateData.whatsapp_webhook_verify_token = whatsapp_webhook_verify_token;
  // Don't overwrite token if placeholder sent
  if (whatsapp_access_token !== undefined && whatsapp_access_token !== "••••••••") {
    updateData.whatsapp_access_token = whatsapp_access_token;
  }

  const { data, error } = await supabase
    .from("stores")
    .update(updateData)
    .eq("id", store_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
