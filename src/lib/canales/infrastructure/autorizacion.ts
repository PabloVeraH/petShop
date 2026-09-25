import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getStoreId } from "@/lib/auth";
import { getAdminStatus, requireStoreAdmin } from "@/lib/admin-check";
import { usuarioDeshabilitado } from "@/lib/usuario-habilitado";

// Autorización común de /api/canales/** (Fase 5, paso 5.1 — C15, §5.4):
//   - 401 sin sesión o sin tienda (getStoreId).
//   - 403 si el usuario está deshabilitado (clerk_users.is_disabled).
//   - soloAdmin: 403 si no es storeAdmin/systemAdmin de ESA tienda (D8:
//     configuración, catálogo, precios, reintentos y liquidaciones).
// El webhook y los crons NO pasan por aquí: se autentican con la firma del
// adaptador y con CRON_SECRET.

export type ResultadoAutorizacion =
  | { ok: true; storeId: string; userId: string }
  | { ok: false; response: NextResponse };

export async function autorizarCanales(opts: { soloAdmin: boolean }): Promise<ResultadoAutorizacion> {
  const ctx = await getStoreId();
  if (!ctx) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  if (await usuarioDeshabilitado(ctx.userId)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  if (opts.soloAdmin) {
    const { sessionClaims } = await auth();
    try {
      requireStoreAdmin(getAdminStatus(sessionClaims), ctx.storeId);
    } catch {
      return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
  }

  return { ok: true, storeId: ctx.storeId, userId: ctx.userId };
}
