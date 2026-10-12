import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { clerkClient } from "@clerk/nextjs/server";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { createServiceClient } from "@/lib/supabase";
import { withErrorLogging } from "@/lib/audit";

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
  // Svix request metadata — ip_address/user_agent live here, never inside `data`.
  event_attributes?: {
    http_request?: {
      client_ip?: string;
      user_agent?: string;
    };
  };
};

export const POST = withErrorLogging(async (req: NextRequest) => {
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

  if (event.type === "user.created" || event.type === "user.updated") {
    // Clerk no garantiza el orden de entrega: un user.created (sin metadata)
    // que llega después del user.updated pisaba store_id/rol con null y el
    // usuario desaparecía de /admin (mascotaspetshop, 2026-10-12). Se escribe
    // el estado ACTUAL del usuario en Clerk, no el del evento.
    let cu;
    try {
      const client = await clerkClient();
      cu = await client.users.getUser(event.data.id);
    } catch (err) {
      // Borrado en Clerk después del evento: no recrear la fila.
      if (isClerkAPIResponseError(err) && err.status === 404) {
        return NextResponse.json({ received: true });
      }
      // Sin estado confiable no se escribe: el 500 hace que Svix reintente.
      throw err;
    }
    const meta = cu.publicMetadata as Record<string, unknown>;
    const nombre = [cu.firstName, cu.lastName].filter(Boolean).join(" ") || null;
    const { error } = await supabase.from("clerk_users").upsert(
      {
        clerk_id: cu.id,
        email: cu.emailAddresses[0]?.emailAddress ?? null,
        ...(nombre ? { nombre } : {}),
        system_admin: Boolean(meta?.systemAdmin),
        store_admin: Boolean(meta?.storeAdmin),
        store_worker: Boolean(meta?.storeWorker),
        store_id: (meta?.storeId as string) ?? null,
        is_disabled: cu.banned ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clerk_id" }
    );
    if (error) throw new Error(`clerk_users upsert failed: ${error.message}`);
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
    };
    const httpRequest = event.event_attributes?.http_request;
    const ipAddress = httpRequest?.client_ip ?? null;
    const userAgent = httpRequest?.user_agent ?? null;

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
      ip_address: ipAddress,
      user_agent: userAgent,
    });
  }

  return NextResponse.json({ received: true });
}, { endpoint: "POST /api/webhooks/clerk" });
