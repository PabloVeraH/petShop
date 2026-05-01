import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { apiGeneralLimit } from "@/middleware/rateLimit";
import { createServiceClient } from "@/lib/supabase";
import { computeLicenseStatus } from "@/lib/license";

const publicRoutes = createRouteMatcher([
  "/auth/(.*)",
  "/api/health",
  "/api/webhooks/(.*)",
  "/api/whatsapp/webhook",
  "/sistema-suspendido",
  "/api/admin/license/(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // Apply rate limiting to all /api routes
  if (req.nextUrl.pathname.startsWith("/api")) {
    const rateLimitResponse = await apiGeneralLimit(req);
    if (rateLimitResponse) return rateLimitResponse;
  }

  if (!publicRoutes(req)) {
    await auth.protect();
  }

  const { sessionClaims } = await auth();

  // License check for non-systemAdmin users
  if (!publicRoutes(req)) {
    const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
    const storeId = meta?.storeId as string | undefined;
    const isSystemAdmin = Boolean(meta?.systemAdmin);

    if (!isSystemAdmin && storeId) {
      const supabase = createServiceClient();
      const { data: store } = await supabase
        .from("stores")
        .select("license_end_date, license_warning_days")
        .eq("id", storeId)
        .single();

      if (store) {
        const status = computeLicenseStatus({
          license_end_date: store.license_end_date,
          license_warning_days: store.license_warning_days,
        });

        if (status.isAutoBlocked) {
          return NextResponse.redirect(new URL("/sistema-suspendido", req.url));
        }
      }
    }
  }

  // Role-based redirect from root
  const { userId } = await auth();
  if (req.nextUrl.pathname === "/" && userId) {
    const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;

    if (meta?.systemAdmin) {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
    if (meta?.storeAdmin) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    if (meta?.storeWorker) {
      return NextResponse.redirect(new URL("/pos", req.url));
    }
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
