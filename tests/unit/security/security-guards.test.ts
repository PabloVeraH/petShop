/**
 * SEC-22 a SEC-33: guardas estáticas del checklist de seguridad (AGENTS.md §24).
 *
 * Corren en cada `npm test` y fallan cuando un cambio rompe una invariante de
 * seguridad que ningún test de endpoint vería: un secreto commiteado, una ruta
 * nueva sin guard, una tabla sin RLS, un filtro PostgREST con input crudo…
 * Si una guarda falla por un caso legítimo, se agrega a su allowlist con la
 * razón — nunca se borra la guarda.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import nextConfig from "../../../next.config";

const ROOT = path.resolve(__dirname, "../../..");
const leer = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function archivos(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) out.push(...archivos(rel, ext));
    else if (ext.test(e.name)) out.push(rel);
  }
  return out;
}

const SRC = archivos("src", /\.(ts|tsx)$/);
const RUTAS_API = archivos("src/app/api", /^route\.ts$/);
const MIGRACIONES = archivos("migrations", /^\d+_.*\.sql$/).filter((f) => !f.includes("/historico/"));

describe("Checklist de seguridad — guardas estáticas", () => {
  // 1-2. Ocultar API keys / eliminar secretos de git
  it("SEC-22: .gitignore excluye .env* y no hay archivos de entorno ni llaves versionados", () => {
    expect(leer(".gitignore")).toMatch(/^\.env\*$/m);
    const versionados = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split("\n");
    expect(versionados.filter((f) => /(^|\/)\.env(\.|$)|\.pem$|\.key$/.test(f))).toEqual([]);
  });

  it("SEC-23: ningún archivo versionado contiene un secreto con formato real", () => {
    const PATRONES = [
      /sk_(live|test)_[A-Za-z0-9]{20,}/, // Clerk secret key
      /eyJhbGciOi[\w-]{10,}\.[\w-]{20,}\.[\w-]{20,}/, // JWT (service_role / anon de Supabase)
      /sb_secret_[\w-]{20,}/, // Supabase secret key (formato nuevo)
      /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
      /sk-or-v1-[a-f0-9]{32,}/, // OpenRouter
      /whsec_[A-Za-z0-9+/]{20,}/, // Svix / Clerk webhook
      /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/, // Resend
      /AKIA[0-9A-Z]{16}/, // AWS / R2
    ];
    const versionados = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => f && !/^(package-lock\.json|graphify-out\/)|\.(png|jpe?g|gif|webp|ico|pdf|xlsx|woff2?)$/.test(f));
    const hallazgos: string[] = [];
    for (const f of versionados) {
      if (!fs.existsSync(path.join(ROOT, f))) continue;
      const txt = leer(f);
      for (const p of PATRONES) if (p.test(txt)) hallazgos.push(`${f} ~ ${p}`);
    }
    expect(hallazgos).toEqual([]);
  });

  // 1 y 3. Solo claves públicas llegan al navegador
  it("SEC-24: las únicas NEXT_PUBLIC_* son las públicas por diseño", () => {
    const PERMITIDAS = new Set([
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY", // segura solo porque toda tabla tiene RLS (SEC-28)
      "NEXT_PUBLIC_IVA_RATE",
    ]);
    const usadas = new Set(SRC.flatMap((f) => leer(f).match(/NEXT_PUBLIC_[A-Z0-9_]+/g) ?? []));
    expect([...usadas].filter((v) => !PERMITIDAS.has(v))).toEqual([]);
  });

  it("SEC-25: ningún Client Component lee secretos ni importa clientes/helpers de servidor", () => {
    const clientes = SRC.filter((f) => /^\s*["']use client["']/.test(leer(f)));
    const malos = clientes.filter((f) => {
      const txt = leer(f);
      const envServidor = (txt.match(/process\.env\.[A-Z0-9_]+/g) ?? []).filter(
        (v) => !/NEXT_PUBLIC_|NODE_ENV/.test(v),
      );
      return envServidor.length > 0 || /from ["']@\/lib\/(supabase|canales\/encryption|cron-auth|audit|admin-check|auth)["']/.test(txt);
    });
    expect(malos).toEqual([]);
  });

  // 6-7. Forzar autenticación en cada endpoint
  it("SEC-26: toda ruta /api autentica (sesión, rol, cron o firma) salvo las públicas declaradas", () => {
    const GUARDS = /getStoreId\(|auth\(\)|resolveAdminContext|autorizarCanales|cronAutorizado|requireSystemAdmin|exigirStoreAdmin|currentUser\(/;
    // Públicas sin sesión: cada una se autentica por otro medio (o no expone nada).
    const PUBLICAS: Record<string, string> = {
      "src/app/api/health/route.ts": "solo devuelve {status, timestamp}",
      "src/app/api/webhooks/clerk/route.ts": "firma Svix",
      "src/app/api/whatsapp/webhook/route.ts": "HMAC X-Hub-Signature-256 / verify_token",
      "src/app/api/canales/webhook/[canal]/route.ts": "firma HMAC del adaptador + anti-replay",
    };
    const sinGuard = RUTAS_API.filter((f) => !GUARDS.test(leer(f)) && !(f in PUBLICAS));
    expect(sinGuard).toEqual([]);
    for (const f of Object.keys(PUBLICAS)) expect(fs.existsSync(path.join(ROOT, f))).toBe(true);
  });

  it("SEC-27: el middleware no amplía la lista de rutas públicas sin revisión", () => {
    const mw = leer("src/proxy.ts");
    const bloque = mw.match(/export const publicRoutes = createRouteMatcher\(\[([\s\S]*?)\]\);/)![1];
    const rutas = [...bloque.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(rutas.sort()).toEqual(
      [
        "/auth/(.*)",
        "/api/health",
        "/api/webhooks/(.*)",
        "/api/whatsapp/webhook",
        "/api/canales/webhook/(.*)",
        "/api/cron/(.*)", // cada cron exige Bearer $CRON_SECRET (SEC-26 vía cronAutorizado)
        "/sistema-suspendido",
        "/landing",
      ].sort(),
    );
  });

  // 4. Row-level security en toda tabla
  it("SEC-28: toda tabla creada en migrations/ habilita RLS", () => {
    const creadas = new Set<string>();
    const conRls = new Set<string>();
    for (const f of MIGRACIONES) {
      const sql = leer(f);
      // Prefijo de esquema opcional y de cualquier esquema (public, supabase_migrations, ...).
      for (const m of sql.matchAll(/create table (?:if not exists )?(?:"?\w+"?\.)?"?(\w+)"?/gi)) creadas.add(m[1].toLowerCase());
      for (const m of sql.matchAll(/alter table (?:only )?(?:if exists )?(?:"?\w+"?\.)?"?(\w+)"?\s+enable row level security/gi)) conRls.add(m[1].toLowerCase());
    }
    expect(creadas.size).toBeGreaterThan(0);
    expect([...creadas].filter((t) => !conRls.has(t))).toEqual([]);
  });

  // 13. Parametrizar queries
  it("SEC-29: SQL dinámico solo con format()/USING y SECURITY DEFINER con search_path fijo", () => {
    const malos: string[] = [];
    const definerSinPath = new Set<string>();
    for (const f of MIGRACIONES) {
      const sql = leer(f);
      for (const m of sql.matchAll(/\bEXECUTE\b([^;]*);/gi)) {
        if (/\|\|/.test(m[1]) && !/format\s*\(|\bUSING\b/i.test(m[1])) malos.push(`${f}: EXECUTE concatenado`);
      }
      // En orden de migración: un ALTER FUNCTION ... SET search_path posterior corrige la función.
      for (const m of sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?(\w+)[\s\S]*?\$\$|ALTER FUNCTION (?:public\.)?(\w+)\([^)]*\)\s+SET search_path/gi)) {
        if (m[2]) definerSinPath.delete(m[2]);
        else if (/SECURITY DEFINER/i.test(m[0]) && !/search_path/i.test(m[0])) definerSinPath.add(m[1]);
        else definerSinPath.delete(m[1]);
      }
    }
    expect(malos).toEqual([]);
    expect([...definerSinPath]).toEqual([]);
  });

  it("SEC-30: los filtros PostgREST .or()/.filter() solo interpolan términos saneados", () => {
    const malos: string[] = [];
    for (const f of SRC) {
      const txt = leer(f);
      for (const m of txt.matchAll(/\.(?:or|filter|textSearch)\(\s*`[^`]*\$\{\s*(\w+)\s*\}/g)) {
        const saneado = new RegExp(`const ${m[1]}\\s*=\\s*[^;]*\\.replace\\(/\\[\\(\\)%,\\]/g`);
        if (!saneado.test(txt)) malos.push(`${f}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(malos).toEqual([]);
  });

  // 15. Sanitizar contenido
  it("SEC-31: no se inyecta HTML crudo en el DOM", () => {
    expect(SRC.filter((f) => /dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(|new Function\(/.test(leer(f)))).toEqual([]);
  });

  // 17. Devolver solo lo necesario (sin detalles internos de la BD)
  it("SEC-32: ninguna respuesta 500 expone error.message de la BD", () => {
    const malos = RUTAS_API.filter((f) =>
      /error:\s*\w+\.message[^}]*\}\s*,\s*\{\s*status:\s*500/.test(leer(f)),
    );
    expect(malos).toEqual([]);
  });

  // 16. Restringir archivos
  it("SEC-33: todo endpoint que recibe archivos limita tamaño y tipo", () => {
    const conArchivos = RUTAS_API.filter((f) => /formData\(\)/.test(leer(f)));
    expect(conArchivos.length).toBeGreaterThan(0);
    const malos = conArchivos.filter((f) => {
      const txt = leer(f);
      return !/\.size\s*>/.test(txt) || !/ALLOWED_TYPES|\.type\b|ext !==/.test(txt);
    });
    expect(malos).toEqual([]);
  });

  // 18-19. Security headers y HTTPS
  it("SEC-34: headers de seguridad globales con HSTS ≥ 1 año", async () => {
    const reglas = await nextConfig.headers!();
    const global = reglas.find((r) => r.source === "/(.*)")!;
    const h = Object.fromEntries(global.headers.map((x) => [x.key, x.value]));
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=(\d+)/);
    expect(Number(h["Strict-Transport-Security"].match(/max-age=(\d+)/)![1])).toBeGreaterThanOrEqual(31536000);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toMatch(/DENY|SAMEORIGIN/);
    expect(h["Referrer-Policy"]).toBeTruthy();
    expect(h["Permissions-Policy"]).toBeTruthy();
    // El CSP (nonce) lo agrega src/proxy.ts — cubierto en MW-* de middleware-routing.test.ts.
    expect(leer("src/proxy.ts")).toMatch(/response\.headers\.set\("Content-Security-Policy"/);
  });
});
