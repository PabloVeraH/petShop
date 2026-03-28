import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const publicRoutes = createRouteMatcher([
  "/auth/(.*)",
  "/api/health",
  "/api/webhooks/(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!publicRoutes(req)) {
    await auth.protect();
  }

  const { userId, sessionClaims } = await auth();

  // Role-based redirect from root
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
    // Default fallback
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
