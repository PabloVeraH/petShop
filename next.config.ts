import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";

const cspDirectives = [
  "default-src 'self'",
  [
    "script-src 'self' 'unsafe-inline'",
    isDev ? "'unsafe-eval'" : "",
    "https://clerk.accounts.dev https://*.clerk.accounts.dev",
  ].filter(Boolean).join(" "),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.clerk.com https://img.clerk.com",
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    "https://*.supabase.co wss://*.supabase.co",
    "https://api.clerk.com https://*.clerk.accounts.dev",
    "https://clerk-telemetry.com",
    "https://graph.facebook.com",
  ].join(" "),
  isDev ? "worker-src 'self' blob:" : "worker-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: cspDirectives.join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: corsOrigin },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
          { key: "Access-Control-Max-Age", value: "86400" },
        ],
      },
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
