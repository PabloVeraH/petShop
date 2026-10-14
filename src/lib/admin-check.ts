import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createServiceClient } from "./supabase";

export interface AdminContext {
  userId: string;
  storeId: string;
  isStoreAdmin: boolean;
  isSystemAdmin: boolean;
}

export function getAdminStatus(sessionClaims: unknown): AdminContext | null {
  const claims = sessionClaims as { sub?: string; publicMetadata?: Record<string, unknown> } | null | undefined;
  if (!claims?.publicMetadata) return null;

  const meta = claims.publicMetadata;

  return {
    userId: claims.sub || "",
    storeId: meta.storeId as string,
    isStoreAdmin: !!meta.storeAdmin,
    isSystemAdmin: !!meta.systemAdmin,
  };
}

export function requireSystemAdmin(admin: AdminContext | null) {
  if (!admin?.isSystemAdmin) {
    throw new Error("System admin required");
  }
}

export function requireStoreAdmin(admin: AdminContext | null, requiredStoreId?: string) {
  if (!admin?.isStoreAdmin && !admin?.isSystemAdmin) {
    throw new Error("Store admin required");
  }
  if (requiredStoreId && admin.storeId !== requiredStoreId && !admin.isSystemAdmin) {
    throw new Error("Unauthorized store");
  }
}

/**
 * Exige que la sesión actual sea storeAdmin de `storeId` (o systemAdmin).
 * A diferencia de requireStoreAdmin (que lanza), devuelve la respuesta 403
 * lista para retornar, o null si está autorizado — sin try/catch en el
 * llamador:
 *
 *   const denegado = await exigirStoreAdmin(store_id);
 *   if (denegado) return denegado;
 */
export async function exigirStoreAdmin(storeId: string): Promise<NextResponse | null> {
  const { sessionClaims } = await auth();
  try {
    requireStoreAdmin(getAdminStatus(sessionClaims), storeId);
    return null;
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
}

/**
 * Cross-verifies systemAdmin role against the DB to catch stale JWT claims.
 * Clerk JWTs are not automatically refreshed when publicMetadata changes,
 * so a demoted user could still hold a JWT claiming systemAdmin.
 *
 * Throws Error if the DB doesn't confirm system_admin status.
 */
export async function requireSystemAdminConsistent(admin: AdminContext | null): Promise<void> {
  if (!admin?.isSystemAdmin) {
    throw new Error("System admin required");
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("clerk_users")
    .select("system_admin")
    .eq("clerk_id", admin.userId)
    .single();

  if (error || !data?.system_admin) {
    throw new Error("System admin required");
  }
}

/**
 * Returns a corrected AdminContext by cross-verifying the JWT systemAdmin claim
 * against the DB. If the JWT claims systemAdmin but the DB disagrees (stale JWT),
 * the context is downgraded to storeAdmin (or a non-admin).
 *
 * Use this in dual-auth routes that accept both systemAdmin and storeAdmin,
 * where a stale JWT would incorrectly grant systemAdmin privileges (e.g.,
 * seeing all stores' data instead of only the user's store).
 */
export async function resolveAdminContext(admin: AdminContext | null): Promise<AdminContext | null> {
  if (!admin) return null;
  if (!admin.isSystemAdmin) return admin;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("clerk_users")
    .select("system_admin, store_admin")
    .eq("clerk_id", admin.userId)
    .single();

  if (error || !data?.system_admin) {
    return { ...admin, isSystemAdmin: false, isStoreAdmin: data?.store_admin ?? false };
  }
  return admin;
}