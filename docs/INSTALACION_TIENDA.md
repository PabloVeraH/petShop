# Instalar petShop en una tienda nueva

Procedimiento para instalar el sistema a una tienda cliente con su propia
rama, despliegue, base de datos y autenticación, y para actualizarla después
desde `main` **bajo supervisión** (nunca automáticamente).

Leyenda: ✅ verificado en el código o en la BD demo (2026-10-09) ·
⚠️ verificar en el dashboard del proveedor o al ejecutar por primera vez.

---

## 0. Modelo

```
main ──────────────► Vercel "demo" (deploy automático) ─► Supabase demo   demo.ammapet.cl
  │
  │  PR manual main → tienda/<nombre>, cuando tú decides
  ▼
tienda/<nombre> ───► Vercel "<nombre>" ─► Supabase <nombre> + app Clerk <nombre>   <nombre>.ammapet.cl
```

| Recurso | Por tienda | Compartido |
|---|---|---|
| Rama git | `tienda/<nombre>` | repo `PabloVeraH/petShop` |
| Vercel | proyecto propio, *Production Branch* = `tienda/<nombre>` | cuenta/equipo |
| Supabase | proyecto propio | organización |
| Clerk | **aplicación** propia (instancia de producción) | cuenta Clerk |
| Cloudflare R2 | — | bucket y dominio `imgs.ammapet.cl` (ver §5.1) |
| Dominio | subdominio `<nombre>.ammapet.cl` | `ammapet.cl` |

Por qué todo separado y no un tenant más en el demo:
- las migraciones que se aplican para `main` cambiarían el esquema de la tienda
  antes de actualizar su código;
- datos reales de clientes no deben vivir en el entorno demo;
- en Clerk el `storeId`/rol vive en la `publicMetadata` del usuario (una por
  usuario) y el webhook recibe los eventos de **todos** los usuarios de la
  aplicación ✅ (`src/lib/auth.ts`, `src/app/api/webhooks/clerk/route.ts`).

Planes ⚠️: Vercel Hobby es para uso no comercial; Supabase Free limita la
cantidad de proyectos gratuitos activos y pausa los inactivos. Para una tienda
que paga, considerar Vercel Pro y Supabase Pro (con backups). Clerk gratis:
50.000 usuarios retenidos/mes **por aplicación**.

---

## 1. Bloqueante antes de la primera instalación (código en `main`)

**La CSP no permite Clerk de producción.** ✅ El demo usa claves de
desarrollo (`pk_test_`, verificado en el HTML de demo.ammapet.cl) y
`buildCsp()` en `src/middleware.ts` solo permite `*.clerk.accounts.dev` en
`script-src`/`connect-src`. Una instancia de producción sirve su Frontend API
desde un subdominio propio (ej. `clerk.<nombre>.ammapet.cl`, el que indique
Clerk → Domains) ⚠️, que el navegador bloquearía → el login no carga.

Solución pendiente (cambio en `main`, con tests): agregar a la CSP el host
del Frontend API, que viene codificado en la publishable key
(`pk_live_<base64("clerk.dominio$")>`), sin variable nueva. Hasta hacerlo,
no instales ninguna tienda con claves `pk_live_`.

---

## 2. Rama y versión

```bash
git checkout main && git pull
git tag -a v2026.10.0 -m "Base para tienda <nombre>"   # versión que recibe la tienda
git push origin v2026.10.0
git checkout -b tienda/<nombre> v2026.10.0
git push -u origin tienda/<nombre>
```

Reglas de la rama:
- Solo recibe: merges desde `main` (o un tag) y ramas `feat/<nombre>-*` con
  funcionalidad **exclusiva** de esa tienda.
- Lo que podría servir a otra tienda se hace en `main` detrás de una variable
  de entorno (como `MULTI_SUCURSAL` o `ENABLED_CHANNELS`) y se activa en el
  Vercel de la tienda. Así la rama no diverge y los merges siguen siendo chicos.
- Hotfix: se corrige en `main` y baja por merge (o `cherry-pick` si urge).

---

## 3. Supabase

### 3.1 Crear el proyecto
Región cercana a Chile (ej. São Paulo) ⚠️. Guardar la contraseña de la BD.

### 3.2 Esquema base: `migrations/000_baseline.sql`

✅ El esquema base está versionado en `migrations/000_baseline.sql`: `pg_dump
--schema-only --schema=public --no-owner` del demo (2026-10-11, hasta la
086), ya ajustado para el SQL Editor y con las extensiones y el bucket
`instagram-media` incluidos. Las migraciones anteriores están en
`migrations/historico/` solo como referencia: **no se ejecutan** (no
reproducían el esquema real). Ver `migrations/README.md`.

Aplicar en la BD **nueva** (nunca en el demo):

1. Supabase de la tienda → **SQL Editor** → *New query*.
2. Pegar el contenido completo de `000_baseline.sql` → **Run**.
3. Si falla, leer el error antes de reintentar: el SQL Editor puede dejar
   aplicada la parte anterior al error. Ante "already exists", empezar con un
   proyecto vacío en vez de parchear.

- No incluye datos: la tienda arranca vacía (correcto).
- Conserva los `GRANT`/`REVOKE`: los `REVOKE` sobre funciones
  `SECURITY DEFINER` son controles de seguridad.

**Regenerar el baseline** (solo si el demo cambió fuera de las migraciones
numeradas): `pg_dump` ≥ versión del servidor (17), conexión *Session pooler*,
mismos flags; quitar las líneas `\restrict`/`\unrestrict`, cambiar `CREATE
SCHEMA public` por `IF NOT EXISTS` y conservar el encabezado y el bloque de
Storage del archivo actual.

### 3.3 Lo que el baseline no trae
- **pg_cron de canales (`migrations/085`)**: ✅ no aplicada ni en el demo. Va
  en §8.4, después de desplegar.
- **Edge Functions del hub** (`sync-catalog`, `sync-purchase`,
  `supabase/functions/`): desplegadas en el demo; desplegarlas en la tienda
  solo si esa instalación tendrá su propio hub ⚠️.
- Auth de Supabase, Realtime, webhooks de BD, Vault: ✅ el demo no los usa
  (verificado 2026-10-11).

### 3.4 Verificar
En el SQL Editor de la tienda (valores esperados al 2026-10-11):
```sql
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public')                                       as funciones,  -- 46
  (select count(*) from pg_tables where schemaname = 'public')        as tablas,     -- 49
  (select count(*) from pg_tables where schemaname = 'public'
    and not rowsecurity)                                              as sin_rls,    -- 0
  (select count(*) from pg_policies where schemaname = 'public')      as politicas,  -- 125
  (select count(*) from storage.buckets where id = 'instagram-media') as bucket;     -- 1
```
- Database → Advisors (security): sin errores nuevos respecto del demo.
- Registrar en la tabla de §10 la última migración incluida (`000_baseline`
  = hasta 086).

---

## 4. Clerk (una aplicación por tienda)

1. Dashboard → *Create application* "petShop – <nombre>" (email; sociales
   opcionales).
2. Pasar a **Production** → *Domains*: `<nombre>.ammapet.cl`; crear en el DNS
   los CNAME que indica Clerk y esperar la verificación ⚠️.
3. *Sessions → Customize session token*:
   ```json
   { "publicMetadata": "{{user.public_metadata}}" }
   ```
   Sin esto no funcionan roles ni tienda ✅.
4. *Webhooks* → endpoint `https://<nombre>.ammapet.cl/api/webhooks/clerk` con
   `user.created`, `user.updated`, `user.deleted`, `session.created`,
   `session.ended`, `session.removed` ✅. Copiar el signing secret →
   `CLERK_WEBHOOK_SECRET`.
5. *Restrictions* → registro **restringido** (solo invitación) ⚠️: el
   onboarding (`/api/onboarding/complete`) deja a cualquier usuario nuevo sin
   tienda crear una ✅.
6. Organizations: desactivadas (no se usan).
7. Claves `pk_live_…` / `sk_live_…` → Vercel (§6).

---

## 5. Servicios externos

### 5.1 Fotos de producto (Cloudflare R2)
Recomendado: **compartir** bucket y dominio `imgs.ammapet.cl`. ✅ Las keys
ya van por tienda (`productos/<storeId>/…`) y borrar valida ese prefijo; la
CSP (`src/middleware.ts`) tiene `imgs.ammapet.cl` fijo, así que un dominio
distinto exigiría cambiar código.
- Mismas `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`.
- Token R2 propio por tienda (Object Read & Write, solo ese bucket) para
  poder revocarlo sin afectar al resto.
- Límite: si una tienda se va, sus fotos se extraen por prefijo `storeId`.

### 5.2 Email (Resend)
`RESEND_API_KEY` y `RESEND_FROM_DEFAULT` (sin ella usa `no-reply@tuapp.com`
✅). Verificar en Resend el dominio remitente ⚠️.

### 5.3 IA (OpenRouter)
`OPENROUTER_API_KEY` (key propia por tienda para separar costos) y
opcional `OPENROUTER_MODEL`.

### 5.4 Canales (Rappi / PedidosYa / Uber Eats / Instagram)
- Credenciales de cada canal: se cargan desde la app, cifradas con
  `ENCRYPTION_KEY` ✅.
- Variables y checklist: `docs/canales-stock/rappi_salida_produccion.md`
  (en producción `RAPPI_API_BASE` y `RAPPI_AUTH_BASE` son obligatorias).
- Webhook de cada canal: `https://<nombre>.ammapet.cl/api/canales/webhook/<canal>`.

### 5.5 Hub central (opcional)
`HUB_URL`, `HUB_SYNC_SECRET`, `STORE_ID` en Vercel **y** en las Edge
Functions `sync-catalog`/`sync-purchase` si se usan ✅. Desplegar Edge
Functions solo con autorización.

---

## 6. Vercel

1. *Add New → Project* → importar `PabloVeraH/petShop`.
2. *Settings → Git → Production Branch*: `tienda/<nombre>`.
3. *Environment Variables* (Production) — plantilla completa en el
   Anexo A:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | `pk_live_` / `sk_live_` de la app Clerk de la tienda |
| `CLERK_WEBHOOK_SECRET` | §4.4 |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `_SIGN_UP_URL` | `/auth/login` / `/auth/signup` |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | del proyecto Supabase **de la tienda** |
| `ENCRYPTION_KEY` | **nueva**: `openssl rand -hex 32` (64 hex) ✅ |
| `CRON_SECRET` | nuevo: `openssl rand -hex 32` |
| `MULTI_SUCURSAL` | `true` solo si la tienda tiene sucursales |
| `ENABLED_CHANNELS` | ej. `rappi,pedidosya` |
| `R2_*`, `RESEND_*`, `OPENROUTER_*`, `RAPPI_*`… | §5 |

   Nunca reutilizar `ENCRYPTION_KEY`, `CRON_SECRET` ni la service role del demo.
4. *Domains*: `<nombre>.ammapet.cl` + CNAME en el DNS ⚠️.
5. *Deployment Protection*: desactivada en **production** (pg_net y los
   webhooks de canales necesitan llegar sin login); activa en previews.
6. Cron `email-alerts` de `vercel.json` ✅: queda activo; es correcto porque
   cada proyecto lee su propia BD.
7. **Previews**: las variables del entorno *Preview* no deben apuntar a la BD
   de la tienda (un preview de un PR correría código nuevo contra datos
   reales). Opción simple: no definir variables de Preview en este proyecto y
   probar las novedades en el demo.
8. Deploy.

---

## 7. Datos iniciales

1. En Clerk (prod de la tienda) crear tu usuario y ponerle en *Public
   metadata*: `{ "systemAdmin": true }`.
2. Crear el usuario del dueño (invitación). Al entrar pasa por
   `/auth/onboarding`, nombra la tienda y queda como `storeAdmin` ✅ (el
   trigger de la 086 crea su negocio automáticamente).
3. Licencia: con `MULTI_SUCURSAL` apagado, /admin → Licencia es solo
   lectura. Definirla en `businesses` (el trigger la copia a `stores`) ✅:
   ```sql
   update businesses set license_start_date = '2026-10-15',
                         license_end_date   = '2027-10-15'
   where id = (select business_id from stores where name = '<nombre tienda>');
   ```
4. Plan de cuentas: no requiere carga, está en código (`CUENTAS`) ✅.
5. Configuración de la tienda (dirección, fidelización, etc.) desde /admin.

---

## 8. Verificación

1. Login con tu systemAdmin y con el dueño; consola del navegador sin
   errores de CSP.
2. Clerk → Webhooks → los eventos responden 200; `clerk_users` y
   `user_sessions` se llenan en la BD de la tienda.
3. Venta de prueba en /pos, anularla; subir foto de producto.
4. **Crons de canales (085)**, si usa canales, ya desplegado:
   ```sql
   select vault.create_secret('https://<nombre>.ammapet.cl', 'petshop_app_url');
   select vault.create_secret('<CRON_SECRET de esta tienda>', 'petshop_cron_secret');
   ```
   Activar `pg_cron` y `pg_net` y aplicar `migrations/085_pg_cron_canales.sql`.
5. Limpiar los datos de prueba antes de entregar.

---

## 9. Actualizar una tienda desde `main` (supervisado)

1. Decidir qué baja: `main` entero o un tag (`git tag -a v2026.11.0`).
2. Revisar el delta:
   ```bash
   git fetch origin
   git log --oneline origin/tienda/<nombre>..v2026.11.0
   git diff --stat origin/tienda/<nombre>...v2026.11.0 -- migrations/
   ```
3. PR `v2026.11.0 → tienda/<nombre>` (o una rama `update/<nombre>-v2026.11.0`
   con el merge y los conflictos resueltos). `npm run build && npm test` en
   verde.
4. **Migraciones primero**: aplicar en el Supabase de la tienda las
   migraciones nuevas, en orden, **antes** del merge (deben ser compatibles
   con el código anterior: aditivas). Si alguna no lo es, coordinar una
   ventana: merge y migración seguidos, fuera del horario de la tienda.
5. Variables de entorno nuevas → Vercel de la tienda.
6. Merge del PR → Vercel despliega la rama → §8.1–8.3 rápido.
7. Actualizar la tabla de §10.

Vuelta atrás: Vercel → Deployments → *Instant Rollback* al deploy anterior
(el código vuelve; la migración aditiva puede quedarse).

---

## 10. Registro de instalaciones

| Tienda | Rama | Dominio | Versión | Última migración | Supabase | Notas |
|---|---|---|---|---|---|---|
| (demo) | `main` | demo.ammapet.cl | — | 086 (085 sin aplicar) | `wnxrdbnvreofrrmhcybc` | Clerk dev |

---

## Anexo A. Variables de entorno

Todas las que lee el código ✅ (`grep -rn "process.env" src supabase
next.config.ts`, 2026-10-09). Copiar a `.env.local` (local) o a Vercel.

```env
# Clerk (aplicación propia por tienda; producción = pk_live_/sk_live_)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/auth/login
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/auth/signup

# Supabase (proyecto propio por tienda)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Secretos propios de cada instalación: openssl rand -hex 32
ENCRYPTION_KEY=
CRON_SECRET=

# Funcionalidades
MULTI_SUCURSAL=            # "true" = con sucursales
ENABLED_CHANNELS=          # ej. rappi,pedidosya
NEXT_PUBLIC_IVA_RATE=      # opcional, default 0.19

# Fotos de producto (Cloudflare R2, §5.1)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=

# Email (Resend)
RESEND_API_KEY=
RESEND_FROM_DEFAULT=

# IA (OpenRouter)
OPENROUTER_API_KEY=
OPENROUTER_MODEL=

# Canales (en producción las *_BASE son obligatorias)
RAPPI_API_BASE=
RAPPI_AUTH_BASE=
PEDIDOSYA_API_BASE=
PEDIDOSYA_AUTH_BASE=
UBEREATS_API_BASE=
UBEREATS_AUTH_BASE=
WHATSAPP_APP_SECRET=

# Hub central (opcional)
HUB_URL=
HUB_SYNC_SECRET=
STORE_ID=

# Opcionales
RATE_LIMIT_USER_MAX=       # default 600 / 5 min por usuario
RATE_LIMIT_API_MAX=        # default 100 / 15 min por IP
CORS_ORIGIN=
SLACK_WEBHOOK_URL=
PAGERDUTY_API_KEY=
```
