import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

// Webhook verification (GET) - required by Meta
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Look up verify token from any store
  const supabase = createServiceClient();
  const { data: store } = await supabase
    .from("stores")
    .select("id")
    .eq("whatsapp_webhook_verify_token", token)
    .single();

  if (!store) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200 });
}

// Incoming messages (POST)
export async function POST(req: NextRequest) {
  const body = await req.json();
  // Acknowledge receipt immediately (Meta requires 200 within 20s)
  // In production: process messages asynchronously
  console.log("WhatsApp webhook:", JSON.stringify(body));
  return NextResponse.json({ ok: true });
}
