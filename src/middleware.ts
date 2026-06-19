import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { apiGeneralLimit } from "@/middleware/rateLimit";
import { createServiceClient } from "@/lib/supabase";
import { computeLicenseStatus } from "@/lib/license";

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const directives = [
    "default-src 'self'",
    // nonce + strict-dynamic: sin 'unsafe-inline' en producción
    // strict-dynamic propaga confianza a scripts cargados dinámicamente (chunks de React/Next.js)
    [
      `script-src 'nonce-${nonce}' 'strict-dynamic'`,
      isDev ? "'unsafe-eval'" : "",
      "https://clerk.accounts.dev https://*.clerk.accounts.dev",
    ].filter(Boolean).join(" "),
    // style-src mantiene unsafe-inline: necesario para Tailwind + Next.js inline styles
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.clerk.com https://img.clerk.com https://*.tile.openstreetmap.org",
    "font-src 'self' data:",
    [
      "connect-src 'self'",
      "https://*.supabase.co wss://*.supabase.co",
      "https://api.clerk.com https://*.clerk.accounts.dev",
      "https://clerk-telemetry.com",
      "https://graph.facebook.com",
      "https://photon.komoot.io",
    ].join(" "),
    isDev ? "worker-src 'self' blob:" : "worker-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  return directives.join("; ");
}

// No requieren autenticación de Clerk
const publicRoutes = createRouteMatcher([
  "/auth/(.*)",
  "/api/health",
  "/api/webhooks/(.*)",
  "/api/whatsapp/webhook",
  "/sistema-suspendido",
  "/landing",
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
  // Generar nonce criptográfico por request para CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const cspHeader = buildCsp(nonce);

  // Propagar nonce al app (server components lo leen con next/headers)
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

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

  // Rutas solo para storeAdmin y systemAdmin
  const adminOnlyRoutes = createRouteMatcher(["/vendedores(.*)"]);
  if (adminOnlyRoutes(req) && !isSystemAdmin && !meta?.storeAdmin) {
    return NextResponse.redirect(new URL("/pos", req.url));
  }

  // storeWorker solo puede acceder a /pos — todo lo demás redirige al POS
  // Las rutas /api tienen sus propios guards; aquí solo protegemos páginas
  const isStoreWorker = Boolean(meta?.storeWorker) && !Boolean(meta?.storeAdmin) && !isSystemAdmin;
  const workerAllowedRoutes = createRouteMatcher(["/pos(.*)", "/api/(.*)"]);
  if (isStoreWorker && !workerAllowedRoutes(req)) {
    return NextResponse.redirect(new URL("/pos", req.url));
  }

  // Redirect desde raíz según rol
  if (req.nextUrl.pathname === "/" && userId) {
    if (isSystemAdmin) return NextResponse.redirect(new URL("/admin", req.url));
    if (meta?.storeAdmin) return NextResponse.redirect(new URL("/dashboard", req.url));
    if (meta?.storeWorker) return NextResponse.redirect(new URL("/pos", req.url));
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Respuesta normal: propagar nonce al app y añadir CSP al response
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", cspHeader);
  return response;
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
