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

## 1. CSP y Clerk de producción (resuelto en `main`, 2026-10-11)

Una instancia de producción de Clerk sirve su Frontend API desde un
subdominio propio de la tienda (ej. `clerk.mascotaspetshop.ammapet.cl`, app
*Secondary* en Clerk). `buildCsp()` (`src/middleware.ts`) lo decodifica de
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_live_<base64("clerk.dominio$")>`) y
lo agrega a `script-src` y `connect-src`: **no hay variable nueva** y no
puede quedar desalineado con la clave. Con `pk_test_` (demo) el CSP no
cambia. Tests MW-34/MW-35.

Regla general: el código es el mismo en `main` y en todas las ramas de
tienda; lo que distingue a una tienda va en sus variables de entorno.

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

Aplicar en la BD **nueva** (nunca en el demo). Preferido: `psql` (≥ 17) con
conexión *Session pooler* de la tienda, en una sola transacción (si algo
falla no queda nada aplicado):

```powershell
$env:PGPASSWORD = "<contraseña BD tienda>"
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -h <host pooler> -p 5432 `
  -U postgres.<id tienda> -d postgres `
  -v ON_ERROR_STOP=1 --single-transaction -f migrations\000_baseline.sql
Remove-Item Env:PGPASSWORD
```

Linux / macOS (bash):
```bash
read -rsp "Contraseña BD tienda: " PGPASSWORD && export PGPASSWORD && echo
psql -h <host pooler> -p 5432 -U postgres.<id tienda> -d postgres \
  -v ON_ERROR_STOP=1 --single-transaction -f migrations/000_baseline.sql
unset PGPASSWORD
```

Alternativa con el SQL Editor:

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
mismos flags; quitar las líneas `\restrict`/`\unrestrict` y las
`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` (el rol `postgres` no puede
cambiarlas), cambiar `CREATE SCHEMA public` por `IF NOT EXISTS` y conservar el
encabezado y el bloque de Storage del archivo actual.

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
- `funciones` = **47** es normal si al crear el proyecto se activó el RLS
  automático: Supabase agrega `public.rls_auto_enable()` (event trigger que
  activa RLS en tablas nuevas). Es inofensiva y se deja. ✅ visto en
  `mascotaspetshop` (2026-10-11). Cualquier otra función extra: revisar.
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
5. *Configure → User & authentication → Access mode* → **Invite-only** →
   *Save* (antes se llamaba "Restrictions"; enlace directo
   `https://dashboard.clerk.com/~/user-authentication/access-mode`). Sin esto
   el onboarding (`/api/onboarding/complete`) deja a cualquier usuario nuevo
   sin tienda crear una ✅.
6. Organizations: desactivadas (no se usan).
7. **Login social (Google, etc.)** ⚠️: en *Production* Clerk **no** trae
   credenciales compartidas como en desarrollo. Un proveedor activado sin
   credenciales propias falla en Google con *"Error 400: invalid_request —
   Missing required parameter: client_id"* (visto 2026-10-12). Elegir una:
   - **A. Desactivarlo** (recomendado si nadie lo pide): *Configure → SSO
     connections* → desactivar Google y cualquier otro proveedor social. Con
     Invite-only basta email + contraseña.
   - **B. Configurar Google:**
     1. Clerk → *Configure → SSO connections* → Google (o *Add connection →
        For all users → Google*) → **Use custom credentials** → copiar el
        **Authorized Redirect URI** (forma
        `https://clerk.<nombre>.ammapet.cl/v1/oauth_callback`; usar el que
        muestre Clerk).
     2. Google Cloud Console → proyecto "petShop" (uno para todas las
        tiendas) → *APIs & Services → OAuth consent screen*: User type
        **External** (dueños con Gmail u otro dominio), nombre, email de
        soporte, dominio autorizado `ammapet.cl`.
     3. *APIs & Services → Credentials → Create Credentials → OAuth client
        ID* → **Web application**: *Authorized JavaScript origins*
        `https://<nombre>.ammapet.cl`; *Authorized redirect URIs* la URI del
        paso 1 → *Create* → copiar Client ID y Client Secret.
     4. Pegarlos en la conexión Google de Clerk → *Save*.
     5. *OAuth consent screen* → **Publish app** (*In production*). En
        *Testing* solo entran los *test users* agregados (máx. 100).
     6. Probar en Clerk → *Account Portal* → *Sign-in*; si falla, *Logs* →
        evento `oauth_callback.failed`.

     Tiendas siguientes: reutilizar el mismo cliente OAuth agregando su
     origin y su redirect URI. Con Invite-only, Google solo deja entrar a
     quien ya tenga usuario o invitación **con ese mismo correo**.
8. Claves `pk_live_…` / `sk_live_…` → Vercel (§6).

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
3. *Environment Variables* (Production) — resumen; qué es cada una, cómo
   obtenerla y qué pasa si falta: **Anexo A**:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | `pk_live_` / `sk_live_` de la app Clerk de la tienda |
| `CLERK_WEBHOOK_SECRET` | §4.4 |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `_SIGN_UP_URL` | `/auth/login` / `/auth/signup` |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | del proyecto Supabase **de la tienda** |
| `ENCRYPTION_KEY` | **nueva**: 64 hex (comando en Anexo A) ✅ |
| `CRON_SECRET` | nuevo: 64 hex (comando en Anexo A) |
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

La tienda se deja **creada antes de entregarla**; el dueño entra directo,
sin onboarding. La app no tiene un botón para crear tiendas: se crea con SQL
y el resto se hace desde la app ✅.

1. **Tu systemAdmin** — Clerk (Production) → *Users → Create user* (tu
   correo y contraseña) → *Metadata → Public*: `{ "systemAdmin": true }` →
   *Save*. El webhook (`user.updated`) marca `clerk_users.system_admin`; el
   middleware exige ambos (JWT y BD) para `/admin` ✅.
2. **Crear la tienda** — SQL Editor del Supabase **de la tienda** (nunca el
   demo):
   ```sql
   insert into stores (name, rut, address, license_start_date, license_end_date)
   values ('<Nombre>', '<RUT con DV, ej. 76.123.456-0>', '<Dirección>',
           '<inicio AAAA-MM-DD>', '<término AAAA-MM-DD>')
   returning id;
   ```
   El trigger `stores_asignar_negocio` crea su fila en `businesses` con esas
   fechas de licencia ✅. Copiar el `id` devuelto.
3. **Asociar tu systemAdmin a la tienda** — Clerk → tu usuario → *Public
   metadata*: `{ "systemAdmin": true, "storeId": "<id del paso 2>" }`.
   Cerrar sesión y volver a entrar (el rol y la tienda viajan en el token).
   Sin `storeId`, `/settings` y el resto de pantallas de tienda responden
   401: `getStoreId()` no encuentra tienda ✅.
4. **Configurar la tienda** — `/settings`: ubicación en el mapa, teléfono,
   email remitente (`@ammapet.cl`, A.4), fidelización.
5. **Crear al dueño** — `/admin → Usuarios` → crear usuario con rol
   **storeAdmin**: queda con el `storeId` de la tienda y entra sin pasar por
   el onboarding ✅. (`/admin` muestra "Sin tienda asignada" hasta que exista
   la tienda del paso 2.)
6. Licencia: ya quedó definida en el paso 2. Para cambiarla después,
   actualizar `businesses` (el trigger `businesses_propagar_licencia` la copia
   a `stores`) ✅:
   ```sql
   update businesses set license_start_date = '2026-10-15',
                         license_end_date   = '2027-10-15'
   where id = (select business_id from stores where name = '<nombre tienda>');
   ```
7. Plan de cuentas: no requiere carga, está en código (`CUENTAS`) ✅.

No hacer el onboarding con el systemAdmin: crearía la tienda a su nombre y
el onboarding del dueño crearía una segunda tienda separada.

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
| mascotaspetshop | `tienda/mascotasPetShop` | mascotaspetshop.ammapet.cl | — | `000_baseline` (hasta 086; 085 sin aplicar) | `ldgkcygdyszvrrmiekiy` | Baseline aplicado 2026-10-11. Clerk: app secundaria. Vercel y tienda creados 2026-10-12 |

---

## Anexo A. Variables de entorno

Todas las que lee el código ✅ (`grep -rn "process.env" src supabase
next.config.ts`, 2026-10-12). Se cargan en Vercel → *Settings →
Environment Variables*, entorno **Production** (ver §6.7 sobre Preview), o
en `.env.local` para desarrollo. **Toda variable nueva o cambiada exige
Redeploy**: un deploy existente no las toma.

Reglas:
- Pegar solo el valor: sin comillas, sin espacios ni saltos de línea al
  final, sin `Bearer ` (el código lo agrega). Un espacio sobrante da 401.
- Nunca copiar del demo `CRON_SECRET`, `ENCRYPTION_KEY` ni nada de Supabase
  o Clerk: cada tienda tiene los suyos.
- Claves de servicios externos (OpenRouter, Resend, R2): una **por tienda**,
  con el nombre `petshop-<nombre>`, para ver su gasto y revocarla sin
  afectar al resto.

Generar un secreto aleatorio (64 hex), uno distinto por variable:
```powershell
# Windows (PowerShell) — generador criptográfico; no usar Get-Random
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | % { '{0:x2}' -f $_ })
```
```bash
# Linux / macOS
openssl rand -hex 32
```

### A.1 Obligatorias

| Variable | Qué es / qué pasa si falta | Cómo obtenerla |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clave pública de Clerk (`pk_live_…`). Sin ella no hay login. También define el host de Clerk en la CSP (§1) | Clerk → app de la tienda, instancia **Production** → *Configure → API keys* |
| `CLERK_SECRET_KEY` | Clave secreta de Clerk (`sk_live_…`), solo servidor | Mismo lugar |
| `CLERK_WEBHOOK_SECRET` | Firma del webhook (`whsec_…`). Sin ella los usuarios y sesiones no se sincronizan a `clerk_users` | Clerk → *Webhooks* → endpoint de la tienda (§4.4) → *Signing Secret* |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/auth/login`. Sin ella Clerk manda a su propia página de login | Valor fijo |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/auth/signup` | Valor fijo |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase **de la tienda** (`https://<ref>.supabase.co`) | Supabase → proyecto de la tienda → *Connect* (o *Project Settings → Data API*) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anon/publishable | Supabase → *Project Settings → API Keys* |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave service_role: omite RLS, **solo servidor**, nunca en logs | Mismo lugar (*service_role* / *secret*) |
| `CRON_SECRET` | Autentica los crons (`Authorization: Bearer …`). Sin ella el cron diario `email-alerts` responde 401 y no envía nada | Generarla (64 hex, arriba). Si usa canales, la misma va al Vault (§8.4) |
| `ENCRYPTION_KEY` | Clave AES-256 que cifra las credenciales de canales. Exactamente 64 caracteres hex. Sin ella (o con otro largo) falla guardar o leer credenciales de Rappi/PedidosYa/etc. **Si se cambia, las credenciales ya guardadas quedan ilegibles** | Generarla (64 hex, arriba), una sola vez por tienda |
| `OPENROUTER_API_KEY` | Clave de IA (`sk-or-v1-…`). Sin ella el recomendador del POS y el optimizador de vencimientos responden "OpenRouter no configurado" (503) | Ver A.3 |

### A.2 Fotos de producto: Cloudflare R2

La tienda comparte el bucket `demo-ammapet` y el dominio `imgs.ammapet.cl`
del demo (§5.1); las fotos quedan bajo `productos/<storeId>/…`. Si falta
cualquiera de las cinco, subir fotos falla con "Faltan variables de entorno
de R2".

| Variable | Valor / cómo obtenerla |
|---|---|
| `R2_ACCOUNT_ID` | El mismo del demo: Cloudflare → *R2 Object Storage* → panel derecho "Account ID" (también es el `<id>` de `https://<id>.r2.cloudflarestorage.com`) |
| `R2_ACCESS_KEY_ID` | Del token propio de la tienda (pasos abajo) |
| `R2_SECRET_ACCESS_KEY` | Del mismo token. Se muestra **una sola vez** |
| `R2_BUCKET_NAME` | `demo-ammapet` |
| `R2_PUBLIC_URL` | `https://imgs.ammapet.cl`, **sin `/` final** (el código arma `${R2_PUBLIC_URL}/productos/…` y además rechaza cualquier URL de imagen que no empiece con este valor). La CSP solo permite `imgs.ammapet.cl`: otro dominio exige cambiar `src/middleware.ts` |

Token R2 de la tienda: Cloudflare → *R2 Object Storage* → *Manage API
Tokens* → *Create API Token* → nombre `petshop-<nombre>`, permiso **Object
Read & Write**, *Apply to specific buckets only* → `demo-ammapet`, TTL
Forever → *Create* → copiar Access Key ID y Secret Access Key. Límite: R2 no
acota un token a un prefijo; la separación entre tiendas la impone el código
(borrar valida el prefijo `storeId`).

Prueba: Inventario → subir foto a un producto → la URL debe empezar con
`https://imgs.ammapet.cl/productos/<storeId>/`.

### A.3 IA: OpenRouter

| Variable | Valor / cómo obtenerla |
|---|---|
| `OPENROUTER_API_KEY` | https://openrouter.ai/settings/keys → *Create Key* → nombre `petshop-<nombre>` y **Credit limit** (ej. USD 5) como tope de gasto → copiar `sk-or-v1-…` (se muestra una vez) |
| `OPENROUTER_MODEL` | Opcional. Default del código: `openrouter/free` (enruta a un modelo gratuito disponible). El modelo elegido en `/admin → IA` (`stores.openrouter_model`) tiene prioridad sobre esta variable |

Los modelos de OpenRouter se retiran sin aviso (`z-ai/glm-4.5-air:free`
desapareció en 2026-10); verificar en https://openrouter.ai/models. Los
`:free` tienen un límite diario de requests (1000/día con créditos cargados,
según `GET /api/v1/key`).

Probar la clave sin la app (la clave se pide sin mostrarla):
```powershell
# Windows (PowerShell)
$k = (Read-Host "Pega la clave").Trim()
(Invoke-RestMethod -Uri "https://openrouter.ai/api/v1/key" -Headers @{ Authorization = "Bearer $k" }).data
$h = @{ Authorization = "Bearer $k"; "Content-Type" = "application/json" }
$b = '{"model":"openrouter/free","messages":[{"role":"user","content":"Responde solo: ok"}]}'
(Invoke-RestMethod -Uri "https://openrouter.ai/api/v1/chat/completions" -Method Post -Headers $h -Body $b).choices[0].message.content
```
```bash
# Linux / macOS
read -rsp "Pega la clave: " K && echo
curl -s https://openrouter.ai/api/v1/key -H "Authorization: Bearer $K"; echo
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
  -d '{"model":"openrouter/free","messages":[{"role":"user","content":"Responde solo: ok"}]}'; echo
unset K
```
401 = clave mal pegada (típico: prefijo `sk-or-v1-` duplicado o espacio).

### A.4 Email: Resend

| Variable | Valor / cómo obtenerla |
|---|---|
| `RESEND_API_KEY` | https://resend.com/api-keys → *Create API Key* → nombre `petshop-<nombre>`, permiso **Sending access**, dominio `ammapet.cl` → copiar `re_…` (una vez). Sin ella no sale ningún email |
| `RESEND_FROM_DEFAULT` | Remitente, ej. `MascotasPetShop <no-reply@ammapet.cl>`. Sin ella usa `no-reply@tuapp.com`, que Resend rechaza (dominio no verificado) |

Dominio remitente (una vez para todas las tiendas): https://resend.com/domains
→ `ammapet.cl` debe estar **Verified**. Si no: *Add Domain* → crear en
Cloudflare → DNS los registros MX/TXT (SPF, DKIM) exactamente como los
muestra Resend (CNAME en *DNS only*) → *Verify DNS Records*.

El campo "email remitente" de `/settings` (`stores.resend_from_email`) tiene
prioridad sobre `RESEND_FROM_DEFAULT` y también debe ser `@ammapet.cl`.

### A.5 Canales de venta (solo si la tienda los usa)

| Variable | Valor |
|---|---|
| `ENABLED_CHANNELS` | Lista separada por comas, ej. `rappi,pedidosya`. Vacía = ningún canal visible |
| `RAPPI_API_BASE` / `RAPPI_AUTH_BASE` | Obligatorias en producción si `rappi` está habilitado. Valores en `docs/canales-stock/rappi_salida_produccion.md` |
| `PEDIDOSYA_API_BASE` / `PEDIDOSYA_AUTH_BASE` | Ídem para PedidosYa (los entrega el canal al aprobar la integración) |
| `UBEREATS_API_BASE` / `UBEREATS_AUTH_BASE` | Ídem para Uber Eats |
| `WHATSAPP_APP_SECRET` | Solo si usa WhatsApp: Meta for Developers → app → *App settings → Basic → App secret*. Sin ella el webhook de WhatsApp responde 500 |

Las credenciales de cada canal (usuario, token) **no** son variables: se
cargan desde la app y se guardan cifradas con `ENCRYPTION_KEY`.

### A.6 Opcionales

| Variable | Default si falta | Para qué |
|---|---|---|
| `CORS_ORIGIN` | `http://localhost:3000` | Header `Access-Control-Allow-Origin` de `/api/*` (`next.config.ts`). Poner `https://<nombre>.ammapet.cl`. La app llama a su propia API desde el mismo dominio, así que no la bloquea si falta |
| `NEXT_PUBLIC_IVA_RATE` | `0.19` | Tasa de IVA |
| `RATE_LIMIT_USER_MAX` | 600 / 5 min por usuario | Rate limit de `/api` con sesión |
| `RATE_LIMIT_API_MAX` | 100 / 15 min por IP | Rate limit de `/api` sin sesión |
| `HUB_URL`, `HUB_SYNC_SECRET`, `STORE_ID` | hub desactivado | Hub central (§5.5); también en las Edge Functions |
| `SLACK_WEBHOOK_URL`, `PAGERDUTY_API_KEY` | sin alertas externas | Alertas de seguridad |

`MULTI_SUCURSAL` existe solo en la rama `feat/sucursales`; el código de
`main` no la lee.

### A.7 Plantilla `.env`

```env
# A.1 Obligatorias
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/auth/login
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/auth/signup
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
ENCRYPTION_KEY=
OPENROUTER_API_KEY=

# A.2 R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=demo-ammapet
R2_PUBLIC_URL=https://imgs.ammapet.cl

# A.3 / A.4
OPENROUTER_MODEL=
RESEND_API_KEY=
RESEND_FROM_DEFAULT=

# A.5 Canales
ENABLED_CHANNELS=
RAPPI_API_BASE=
RAPPI_AUTH_BASE=
PEDIDOSYA_API_BASE=
PEDIDOSYA_AUTH_BASE=
UBEREATS_API_BASE=
UBEREATS_AUTH_BASE=
WHATSAPP_APP_SECRET=

# A.6 Opcionales
CORS_ORIGIN=
NEXT_PUBLIC_IVA_RATE=
RATE_LIMIT_USER_MAX=
RATE_LIMIT_API_MAX=
HUB_URL=
HUB_SYNC_SECRET=
STORE_ID=
SLACK_WEBHOOK_URL=
PAGERDUTY_API_KEY=
```
