import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users").select("store_id").eq("clerk_id", userId).single();
  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

  const { data, error } = await supabase
    .from("stores")
    .select("id, name, rut, address, phone, email, whatsapp_enabled, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_webhook_verify_token")
    .eq("id", user.store_id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Mask access token for security
  return NextResponse.json({
    ...data,
    whatsapp_access_token: data?.whatsapp_access_token ? "••••••••" : "",
  });
}

export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users").select("store_id").eq("clerk_id", userId).single();
  if (!user?.store_id) return NextResponse.json({ error: "Store not found" }, { status: 400 });

  const body = await req.json();

  // Don't overwrite token if placeholder sent
  if (body.whatsapp_access_token === "••••••••") {
    delete body.whatsapp_access_token;
  }

  const { data, error } = await supabase
    .from("stores")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", user.store_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
