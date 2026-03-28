import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { createServiceClient } from "@/lib/supabase";

type ClerkWebhookEvent = {
  type: string;
  data: {
    id: string;
    email_addresses: { email_address: string }[];
    public_metadata: Record<string, unknown>;
  };
};

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  // Verify Svix signature
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
  }

  const body = await req.text();
  const wh = new Webhook(webhookSecret);

  let event: ClerkWebhookEvent;
  try {
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const meta = event.data.public_metadata;

  if (event.type === "user.created" || event.type === "user.updated") {
    await supabase.from("clerk_users").upsert(
      {
        clerk_id: event.data.id,
        email: event.data.email_addresses[0]?.email_address ?? null,
        system_admin: Boolean(meta?.systemAdmin),
        store_admin: Boolean(meta?.storeAdmin),
        store_worker: Boolean(meta?.storeWorker),
        store_id: (meta?.storeId as string) ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clerk_id" }
    );
  }

  if (event.type === "user.deleted") {
    await supabase.from("clerk_users").delete().eq("clerk_id", event.data.id);
  }

  return NextResponse.json({ received: true });
}
