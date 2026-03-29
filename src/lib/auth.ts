import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "./supabase";

/**
 * Returns the store_id for the current authenticated user.
 *
 * Fast path: reads storeId from JWT sessionClaims.publicMetadata (no DB query).
 * Fallback: queries clerk_users table for legacy tokens that predate the
 * storeId being written to publicMetadata.
 *
 * Returns null if the user is unauthenticated or has no store association.
 */
export async function getStoreId(): Promise<{ userId: string; storeId: string } | null> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return null;

  const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
  const metaStoreId = meta?.storeId as string | undefined;
  if (metaStoreId) {
    return { userId, storeId: metaStoreId };
  }

  // Fallback: DB lookup for tokens without storeId in publicMetadata
  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("clerk_users")
    .select("store_id")
    .eq("clerk_id", userId)
    .single();

  if (!user?.store_id) return null;
  return { userId, storeId: user.store_id };
}
