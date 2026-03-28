import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { z } from "zod";

const BodySchema = z.object({
  storeName: z.string().min(3).max(100),
});

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { storeName } = parsed.data;
  const supabase = createServiceClient();

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .insert({ name: storeName })
    .select()
    .single();

  if (storeError) {
    return NextResponse.json({ error: storeError.message }, { status: 500 });
  }

  const client = await clerkClient();

  // Get email to sync clerk_users record immediately (don't wait for webhook)
  const clerkUser = await client.users.getUser(userId);
  const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";

  await supabase.from("clerk_users").upsert(
    {
      clerk_id: userId,
      email,
      store_id: store.id,
      store_admin: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clerk_id" }
  );

  await client.users.updateUserMetadata(userId, {
    publicMetadata: {
      storeAdmin: true,
      storeId: store.id,
    },
  });

  return NextResponse.json({ storeId: store.id });
}
