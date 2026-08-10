import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";

// Webhook verification (GET) - required by Meta
export const GET = withErrorLogging(async (req: NextRequest) => {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Look up verify token from any store
  const supabase = createServiceClient();
  const { data: stores } = await supabase
    .from("stores")
    .select("id")
    .eq("whatsapp_webhook_verify_token", token);

  if (!stores || stores.length === 0) return new NextResponse("Forbidden", { status: 403 });
  if (stores.length > 1) {
    console.error(`[whatsapp] Integridad: ${stores.length} stores comparten el mismo webhook verify token`);
  }
  return new NextResponse(challenge, { status: 200 });
}, { endpoint: "GET /api/whatsapp/webhook" });

// Incoming messages (POST)
export const POST = withErrorLogging(async (req: NextRequest) => {
  // Verify Meta's HMAC-SHA256 signature before processing
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error("WHATSAPP_APP_SECRET not configured");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const rawBody = await req.text();

  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");

  let signatureValid = false;
  try {
    signatureValid = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    // timingSafeEqual throws if buffers have different lengths
    signatureValid = false;
  }

  if (!signatureValid) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Acknowledge receipt immediately (Meta requires 200 within 20s)
  // In production: process messages asynchronously
  // NOTE: Do NOT log the body — it contains customer PII (phone numbers, message content)
  return NextResponse.json({ ok: true });
}, { endpoint: "POST /api/whatsapp/webhook" });
