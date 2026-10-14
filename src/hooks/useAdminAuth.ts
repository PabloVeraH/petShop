import { useAuth } from "@clerk/nextjs";

export type AdminRole = "systemAdmin" | "storeAdmin" | "storeWorker" | null;

interface AdminAuthData {
  userId: string | null;
  role: AdminRole;
  storeId: string | null;
  isLoading: boolean;
}

export function useAdminAuth(): AdminAuthData {
  const { userId, sessionClaims, isLoaded } = useAuth();

  const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
  let role: AdminRole = null;

  if (meta?.systemAdmin) role = "systemAdmin";
  else if (meta?.storeAdmin) role = "storeAdmin";
  else if (meta?.storeWorker) role = "storeWorker";

  const storeId = (meta?.storeId as string) || null;

  return { userId: userId || null, role, storeId, isLoading: !isLoaded };
}

export function canEditStore(role: AdminRole): boolean {
  return role === "systemAdmin";
}

export function canCreateUser(role: AdminRole): boolean {
  return role === "systemAdmin" || role === "storeAdmin";
}

export function canDeleteUser(role: AdminRole): boolean {
  return role === "systemAdmin";
}

export function canViewUsers(role: AdminRole): boolean {
  return role === "systemAdmin" || role === "storeAdmin";
}
