import type { NextConfig } from "next";

const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";

// CSP se genera dinámicamente por request en src/middleware.ts (nonce-based).
// Aquí solo van los headers estáticos de seguridad.
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
    value: "camera=(), microphone=(), geolocation=(self)",
  },
  // Deshabilitar el filtro XSS de IE/Edge antiguo: tiene bypasses conocidos
  // y puede ser explotado como vector de ataque. La protección real la provee CSP.
  { key: "X-XSS-Protection", value: "0" },
];

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Rutas en inglés que redirigen a su equivalente en español (la app usa español
      // como idioma canónico para estas rutas).
      {
        source: "/workers",
        destination: "/vendedores",
        permanent: false,
      },
      // Rutas en español que redirigen a su equivalente en inglés (redirecciones
      // para usuarios que intentan acceder por el nombre en español).
      {
        source: "/inventario",
        destination: "/inventory",
        permanent: true,
      },
      {
        source: "/inventario/:path*",
        destination: "/inventory/:path*",
        permanent: true,
      },
      {
        source: "/clientes",
        destination: "/customers",
        permanent: true,
      },
      {
        source: "/clientes/:path*",
        destination: "/customers/:path*",
        permanent: true,
      },
      {
        source: "/ventas",
        destination: "/sales",
        permanent: true,
      },
      {
        source: "/ventas/:path*",
        destination: "/sales/:path*",
        permanent: true,
      },
      {
        source: "/proveedores",
        destination: "/suppliers",
        permanent: true,
      },
      {
        source: "/proveedores/:path*",
        destination: "/suppliers/:path*",
        permanent: true,
      },
      {
        source: "/compras",
        destination: "/purchases",
        permanent: true,
      },
      {
        source: "/configuracion",
        destination: "/settings",
        permanent: true,
      },
      {
        source: "/ajustes",
        destination: "/settings",
        permanent: true,
      },
      {
        source: "/cuentas-pagar",
        destination: "/payables",
        permanent: true,
      },
      {
        source: "/cuentas-por-pagar",
        destination: "/payables",
        permanent: true,
      },
      {
        source: "/reportes",
        destination: "/reports",
        permanent: true,
      },
      // NOTA: /reportes/prediccion NO debe redirigirse — ya existe como ruta real
      // con page.tsx en src/app/(app)/reportes/prediccion/
    ];
  },
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
