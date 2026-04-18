export interface AdminContext {
  userId: string;
  storeId: string;
  isStoreAdmin: boolean;
  isSystemAdmin: boolean;
}

export function getAdminStatus(sessionClaims: any): AdminContext | null {
  if (!sessionClaims?.publicMetadata) return null;

  const meta = sessionClaims.publicMetadata as any;

  return {
    userId: sessionClaims.sub || "",
    storeId: meta.storeId,
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
  if (!admin?.isStoreAdmin) {
    throw new Error("Store admin required");
  }
  if (requiredStoreId && admin.storeId !== requiredStoreId) {
    throw new Error("Unauthorized store");
  }
}