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

  // Don't overwrite token if placeholder sent
  if (body.whatsapp_access_token === "••••••••") {
    delete body.whatsapp_access_token;
  }

  const { data, error } = await supabase
    .from("stores")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", store_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
