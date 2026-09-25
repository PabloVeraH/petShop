import { createServiceClient } from "./supabase";

// ¿El usuario está deshabilitado en clerk_users? (AGENTS.md §5.3:
// getStoreId() NO lo valida). Deshabilitar a un usuario lo banea en Clerk,
// lo que revoca sus sesiones, pero un JWT ya emitido sigue siendo válido
// hasta expirar: este chequeo cierra esa ventana en endpoints sensibles.
//
// - Sin fila en clerk_users (ej. un systemAdmin sin tienda propia) → no está
//   deshabilitado: la autenticación sigue siendo de Clerk.
// - Error de BD → se trata como deshabilitado (fail-closed).
export async function usuarioDeshabilitado(userId: string): Promise<boolean> {
  try {
    const { data, error } = await createServiceClient()
      .from("clerk_users")
      .select("is_disabled")
      .eq("clerk_id", userId)
      .maybeSingle();
    if (error) return true;
    return data?.is_disabled === true;
  } catch {
    return true;
  }
}
