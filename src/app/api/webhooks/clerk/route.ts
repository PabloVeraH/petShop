import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { clerkClient } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";

type ClerkWebhookEvent = {
  type: string;
  data: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email_addresses: { email_address: string }[];
    public_metadata: Record<string, unknown>;
    banned?: boolean;
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
    const nombre = [event.data.first_name, event.data.last_name].filter(Boolean).join(" ") || null;
    await supabase.from("clerk_users").upsert(
      {
        clerk_id: event.data.id,
        email: event.data.email_addresses[0]?.email_address ?? null,
        ...(nombre ? { nombre } : {}),
        system_admin: Boolean(meta?.systemAdmin),
        store_admin: Boolean(meta?.storeAdmin),
        store_worker: Boolean(meta?.storeWorker),
        store_id: (meta?.storeId as string) ?? null,
        is_disabled: event.data.banned ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clerk_id" }
    );
  }

  if (event.type === "user.deleted") {
    await supabase.from("clerk_users").delete().eq("clerk_id", event.data.id);
  }

  if (
    event.type === "session.created" ||
    event.type === "session.ended" ||
    event.type === "session.removed"
  ) {
    const sessionData = event.data as unknown as {
      user_id: string;
      id: string;
      ip_address?: string;
      user_agent?: string;
    };

    let { data: clerkUser } = await supabase
      .from("clerk_users")
      .select("store_id")
      .eq("clerk_id", sessionData.user_id)
      .single();

    // If user is not yet in clerk_users, resolve from Clerk API and backfill
    if (!clerkUser) {
      try {
        const client = await clerkClient();
        const cu = await client.users.getUser(sessionData.user_id);
        const email = cu.emailAddresses[0]?.emailAddress ?? sessionData.user_id;
        const nombre = [cu.firstName, cu.lastName].filter(Boolean).join(" ") || email;
        const meta = cu.publicMetadata as Record<string, unknown>;
        const storeId = (meta?.storeId as string) ?? null;

        await supabase.from("clerk_users").upsert(
          {
            clerk_id: cu.id,
            email,
            nombre,
            system_admin: Boolean(meta?.systemAdmin),
            store_admin: Boolean(meta?.storeAdmin),
            store_worker: Boolean(meta?.storeWorker),
            store_id: storeId,
            is_disabled: cu.banned ?? false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "clerk_id" }
        );

        clerkUser = { store_id: storeId };
      } catch {
        // Proceed with null store_id if Clerk API is unavailable
        clerkUser = { store_id: null };
      }
    }

    // Always record the session; store_id is nullable for system admins
    await supabase.from("user_sessions").insert({
      store_id: clerkUser.store_id ?? null,
      user_id: sessionData.user_id,
      clerk_session_id: sessionData.id,
      event_type: event.type,
      ip_address: sessionData.ip_address ?? null,
      user_agent: sessionData.user_agent ?? null,
    });
  }

  return NextResponse.json({ received: true });
}
