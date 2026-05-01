import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { apiGeneralLimit } from "@/middleware/rateLimit";
import { createServiceClient } from "@/lib/supabase";
import { computeLicenseStatus } from "@/lib/license";

// No requieren autenticación de Clerk
const publicRoutes = createRouteMatcher([
  "/auth/(.*)",
  "/api/health",
  "/api/webhooks/(.*)",
  "/api/whatsapp/webhook",
  "/sistema-suspendido",
]);

// Requieren auth pero no deben ser bloqueadas por licencia vencida
// (el systemAdmin necesita /api/admin/license para re-habilitar usuarios)
const skipLicenseCheck = createRouteMatcher([
  "/auth/(.*)",
  "/api/health",
  "/api/webhooks/(.*)",
  "/api/whatsapp/webhook",
  "/sistema-suspendido",
  "/api/admin/license/(.*)",
  "/api/license/status",
]);

export default clerkMiddleware(async (auth, req) => {
  // Rate limiting para todas las rutas /api
  if (req.nextUrl.pathname.startsWith("/api")) {
    const rateLimitResponse = await apiGeneralLimit(req);
    if (rateLimitResponse) return rateLimitResponse;
  }

  // Proteger rutas privadas con Clerk
  if (!publicRoutes(req)) {
    await auth.protect();
  }

  // Extraer claims una sola vez
  const { sessionClaims, userId } = await auth();
  const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
  const isSystemAdmin = Boolean(meta?.systemAdmin);
  const storeId = meta?.storeId as string | undefined;

  // Verificar licencia para usuarios no-systemAdmin en rutas privadas
  if (!skipLicenseCheck(req) && !isSystemAdmin && storeId) {
    const supabase = createServiceClient();
    const { data: store } = await supabase
      .from("stores")
      .select("license_end_date, license_warning_days")
      .eq("id", storeId)
      .single();

    if (store) {
      const { isAutoBlocked } = computeLicenseStatus({
        license_end_date: store.license_end_date,
        license_warning_days: store.license_warning_days,
      });

      if (isAutoBlocked) {
        return NextResponse.redirect(new URL("/sistema-suspendido", req.url));
      }
    }
  }

  // Redirect desde raíz según rol
  if (req.nextUrl.pathname === "/" && userId) {
    if (isSystemAdmin) return NextResponse.redirect(new URL("/admin", req.url));
    if (meta?.storeAdmin) return NextResponse.redirect(new URL("/dashboard", req.url));
    if (meta?.storeWorker) return NextResponse.redirect(new URL("/pos", req.url));
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
