# Plan: Fotografías de productos (Cloudflare R2 + WebP)

Este documento diseña la incorporación de hasta **2 fotografías por producto**
en el formulario de Inventario (`src/app/(app)/inventory/page.tsx`), con
optimización automática a WebP antes de subir, y almacenamiento en un bucket
Cloudflare R2 (S3 API) ya provisionado por el usuario:

```
Endpoint S3:  https://0dd9c41fec1f88e85799f0856e3d9127.r2.cloudflarestorage.com
Bucket:       demo-ammapet
Account ID:   0dd9c41fec1f88e85799f0856e3d9127  (derivado del endpoint)
```

Es un plan — no hay código implementado todavía. Todas las rutas, líneas y
hallazgos citados abajo fueron verificados leyendo el repositorio real (no
asumidos); se marcan explícitamente los puntos que quedan pendientes de
definición.

## 0. Decisiones ya resueltas con el usuario (2026-08-21)

| # | Pregunta | Decisión |
|---|----------|----------|
| 1 | Cómo servir las fotos públicamente desde R2 (privado por defecto) | **Dominio propio conectado al bucket** (R2 Custom Domain, vía Cloudflare). Descartadas: `r2.dev` (no apto para producción) y proxy privado vía Next.js (evita depender del CDN de Cloudflare). |
| 2 | Modelo de datos para las 2 fotos | **2 columnas nullable** en `productos`: reutilizar `imagen_url` (ya existe, sin escritor real hoy) + agregar `imagen_url_2`. Descartada la tabla hija `producto_imagenes` por sobre-ingeniería para un tope fijo de 2. |

### 0.1 Actualización (2026-08-23) — organización de las keys en R2 por producto

Implementado y verificado en producción (credenciales R2 + dominio propio
`demo.ammapet.cl` probados end-to-end: subir → servir → borrar). Al revisar
cómo administrar el bucket manualmente, se cambió la key de
`productos/{storeId}/{uuid}.webp` a **`productos/{storeId}/{productoId}/{uuid}.webp`**
— las fotos quedan agrupadas por producto en el explorador de R2, en vez de
todas sueltas en la carpeta de la tienda.

Esto exigió resolver el problema de orden que motivó originalmente el diseño
plano (Fase 4 más abajo): al crear un producto nuevo, la foto se sube *antes*
de que la fila exista, así que no había `productoId` disponible en ese
momento. Solución: el `id` del producto se genera en el navegador
(`crypto.randomUUID()`) al abrir "Nuevo producto" — antes de cualquier
subida —, viaja en el `FormData` de cada subida a `/api/productos/imagenes`,
y se manda también en el body del `POST /api/productos` al guardar, donde la
ruta lo usa como PK real del `insert` (`ProductoCreateSchema.id`, opcional —
si no viene, la base sigue generando el default como antes). Al editar, no
cambia nada: el `id` ya existe.

`eliminarImagenProducto()` no necesitó cambios — su chequeo de aislamiento
por tenant (`url.startsWith(`${publicUrl}/productos/${storeId}/`)`) sigue
siendo válido como prefijo sin importar cuántos segmentos más tenga la key.

## 1. Estado actual verificado (hallazgos)

- **`productos.imagen_url` ya existe** (`migrations/033_imagen_url_producto.sql`,
  agregada "para sincronización al Hub Central y visualización en la app
  móvil") pero **ningún endpoint la escribe hoy**. Confirmado con
  `grep -rln "imagen_url" src/`: solo aparece en `src/lib/hub-sync.ts` (tipo
  del payload) y en los `SELECT`/passthrough de `src/app/api/productos/route.ts`
  y `src/app/api/productos/[id]/route.ts` — nunca en un `.insert()` o
  `updates{}` real, ni en `ProductoCreateSchema`/`ProductoUpdateSchema`
  (`src/lib/validation/inventario.ts`), ni en el formulario
  (`src/app/(app)/inventory/page.tsx`: ni en `ProductoForm`, ni en
  `EMPTY_FORM`, ni en el JSX). Es una columna huérfana en la práctica.
- **No hay librería de optimización de imágenes instalada** (`sharp` ausente
  de `package.json`) ni cliente S3/R2 (`@aws-sdk/client-s3` ausente).
- **Supabase Storage** se usa hoy solo para medios de Instagram
  (`src/app/api/canales/instagram/upload/route.ts`, bucket
  `instagram-media`) — es el único patrón de subida de archivos existente en
  el repo y sirve de referencia de convenciones (auth con `getStoreId()`,
  whitelist de `Content-Type`, límite de tamaño, key prefijada por
  `storeId`). Los productos usarán R2, no este bucket.
- **`GET /api/productos`** (línea 21) y **`GET /api/inventario`** (línea 23)
  seleccionan listas explícitas de columnas que **no incluyen `imagen_url`**
  — ni el listado ni el modal de edición (que se prellena desde estas
  respuestas, ver `abrirEditar()` líneas 239-257) verían la foto aunque
  existiera en la base.
- **`sharp` y `@aws-sdk/client-s3` ya están en la lista de paquetes que
  Next.js excluye automáticamente del bundling de Route Handlers**
  (`serverExternalPackages`), verificado en
  `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md`
  de la versión instalada (Next 16.2.4) — **no hace falta tocar
  `next.config.ts`** para que funcionen del lado del servidor.
- No existe ningún `export const runtime = "edge"` en `src/app/api/**`
  (`grep` sin resultados) — todas las rutas corren en Node.js runtime, que es
  el requisito para usar `sharp` (necesita Buffers/Node nativo, no funciona
  en Edge).
- El PATCH de productos (`src/app/api/productos/[id]/route.ts` líneas 17-22)
  ya hace `select("*")` sobre el producto actual **antes** de aplicar
  cambios — `imagen_url`/`imagen_url_2` quedarán disponibles ahí sin tocar
  ese `SELECT`.

## 2. Variables de entorno nuevas

Siguiendo la convención de `AGENTS.md §7` (nunca hardcodear secretos, todo
vía variables de entorno validadas al arrancar):

| Variable | Valor / origen | Notas |
|----------|-----------------|-------|
| `R2_ACCOUNT_ID` | `0dd9c41fec1f88e85799f0856e3d9127` | Parte del endpoint S3 dado por el usuario. |
| `R2_ACCESS_KEY_ID` | **Pendiente** — generar token R2 en el dashboard de Cloudflare | Scoped al bucket `demo-ammapet`, permiso Object Read & Write únicamente. |
| `R2_SECRET_ACCESS_KEY` | **Pendiente** — idem | Nunca en el repo ni en logs. |
| `R2_BUCKET_NAME` | `demo-ammapet` | |
| `R2_PUBLIC_URL` | **Pendiente** — dominio propio a conectar (§7.1, decisión abierta) | Base pública tras conectar el R2 Custom Domain, ej. `https://cdn.tudominio.cl`. Sin esto no hay URL pública que guardar en `imagen_url`. |

## 3. Arquitectura del flujo

```
Usuario selecciona archivo (input file, formulario de producto)
        │
        ▼
POST /api/productos/imagenes  (multipart/form-data, mismo storeId autenticado)
        │  1. getStoreId() → 401 si no hay sesión
        │  2. Valida Content-Type (jpeg/png/webp) y tamaño máximo
        │  3. sharp: resize(maxWidth) + reencode a .webp calidad ~80
        │  4. PutObject a R2 con key "productos/{storeId}/{uuid}.webp"
        │  5. Devuelve { url: `${R2_PUBLIC_URL}/productos/{storeId}/{uuid}.webp` }
        ▼
El formulario guarda esa URL en form.imagen_url / form.imagen_url_2
        │
        ▼
Al guardar el producto, la URL viaja como campo normal en el
POST/PATCH /api/productos existente (ya validado por Zod, ya persistido)
```

La conversión a WebP ocurre **en el servidor** (Route Handler), no en el
navegador: es la única forma de mantener las credenciales de R2 fuera del
cliente y de garantizar que lo que se sube siempre está optimizado,
independiente del navegador del usuario.

## 4. Plan paso a paso

### Fase 0 — Prerrequisitos fuera de este repositorio (Cloudflare dashboard)

1. Crear un API Token de R2 con permiso "Object Read & Write" acotado al
   bucket `demo-ammapet` (no usar credenciales de cuenta completas).
2. Conectar un dominio propio al bucket vía R2 Custom Domain (decisión §0.1)
   → define el valor real de `R2_PUBLIC_URL`. **Bloquea la Fase 4 en
   producción** — sin esto no hay URL pública para guardar en `imagen_url`.
3. Cargar las 4 variables de entorno nuevas en Vercel (y en `.env.local` para
   desarrollo) — nunca commitear el `.env` real, solo actualizar
   `.env.example` con las claves sin valores.

### Fase 1 — Migración de base de datos

Usar el skill `nueva-migracion` para obtener el número secuencial real en el
momento de crear el archivo (hoy la última es `071_...`, por lo que
correspondería `072_`, a confirmar contra `ls migrations/ | sort | tail -3`
al momento de ejecutar):

```sql
-- 072_imagen_url_2_producto.sql
-- Agrega la segunda foto de producto (tope de 2 fotos por producto).
-- imagen_url ya existe desde 033_imagen_url_producto.sql pero nunca tuvo
-- un escritor real; esta migración solo agrega el segundo slot.

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS imagen_url_2 TEXT;
```

Idempotente, aditiva, sin impacto en datos existentes (nullable, sin
backfill). No requiere RLS nuevo — `productos` ya tiene su política
existente y el aislamiento real sigue siendo el filtro `store_id` en
aplicación (`AGENTS.md §0.2`).

### Fase 2 — Dependencias npm

```bash
npm install sharp @aws-sdk/client-s3
```

Ambas confirmadas compatibles con Route Handlers de Next.js sin config
adicional (§1). `sharp` instala binarios nativos por plataforma — verificar
que el pipeline de build/deploy (Vercel) las resuelva correctamente en CI,
es soporte oficial de Vercel pero vale la pena confirmarlo en un deploy de
prueba antes de dar la fase por cerrada.

### Fase 3 — Cliente R2 y helper de optimización

Nuevo archivo `src/lib/r2-storage.ts` (server-only, nunca importado desde un
Client Component):

- `createR2Client()`: instancia `S3Client` de `@aws-sdk/client-s3` con
  `region: "auto"`, `endpoint: https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credenciales desde las env vars de la Fase 0. Falla rápido (throw) si
  falta alguna variable requerida, siguiendo el patrón de validación de
  secretos al arrancar (`CLAUDE.md` — "Validate that required secrets are
  present at startup").
- `optimizarImagenProducto(buffer: Buffer): Promise<Buffer>`: usa `sharp` —
  `resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 })`.
  Valores (1200px, calidad 80) son punto de partida razonable, ajustables;
  documentarlos como constantes nombradas, no mágicas (`AGENTS.md` /
  `coding-style.md`).
- `subirImagenProducto(storeId, buffer): Promise<string>`: arma la key
  `productos/${storeId}/${crypto.randomUUID()}.webp`, hace `PutObjectCommand`,
  retorna la URL pública (`${R2_PUBLIC_URL}/${key}`).
- `eliminarImagenProducto(url, storeId): Promise<void>`: **valida que la key
  derivada de la URL empiece con `productos/${storeId}/` antes de emitir
  `DeleteObjectCommand`** — sin este chequeo, una tienda podría borrar el
  objeto de otra si llegara a conocer o adivinar su URL (la key no tiene otra
  protección más que este prefijo; ver riesgo en §5).
- Si la conversión con `sharp` falla (archivo corrupto, formato no
  decodificable), la función debe propagar el error — nunca hacer fallback
  silencioso a subir el archivo original sin optimizar.

### Fase 4 — Endpoint de subida y borrado

Nuevo `src/app/api/productos/imagenes/route.ts`, mismo patrón de
`canales/instagram/upload/route.ts` (auth, whitelist de tipo, límite de
tamaño) más el paso de optimización y el cliente R2 en vez de Supabase
Storage:

- **`POST`** (multipart/form-data, campo `file`):
  1. `getStoreId()` → 401 si no hay sesión.
  2. Whitelist de entrada: `image/jpeg`, `image/png`, `image/webp` (se
     excluye `image/gif` — no tiene sentido convertir un GIF animado a WebP
     estático sin decisión de producto explícita sobre perder la animación).
  3. Límite de tamaño de entrada — propuesta 8 MB (mismo orden de magnitud
     que el límite de 10 MB ya usado en `instagram/upload/route.ts`),
     **a confirmar** (§7.3).
  4. `optimizarImagenProducto()` + `subirImagenProducto()`.
  5. Responde `{ url }` con status 201.
- **`DELETE`** (body `{ url }`):
  1. `getStoreId()` → 401 si no hay sesión.
  2. `eliminarImagenProducto(url, storeId)` (valida el prefijo de tenant
     internamente, ver Fase 3).
  3. Responde 204. Usado por el botón "eliminar" del formulario (Fase 6)
     cuando el usuario descarta una foto recién subida sin haber guardado el
     producto todavía.

Este endpoint es independiente de un `producto.id` (igual que
`instagram/upload`), porque al crear un producto nuevo todavía no existe un
ID al momento de subir la foto — el flujo es "subir primero, asociar la URL
al guardar el producto después", igual que ya hace el canal de Instagram con
sus propios medios.

### Fase 5 — Validación Zod

En `src/lib/validation/inventario.ts`, agregar a `ProductoCreateSchema` y
`ProductoUpdateSchema`:

```typescript
imagen_url: z.string().url().max(2048).nullable().optional()
  .refine((v) => !v || v.startsWith(process.env.R2_PUBLIC_URL ?? ""), {
    message: "URL de imagen inválida",
  }),
imagen_url_2: z.string().url().max(2048).nullable().optional()
  .refine((v) => !v || v.startsWith(process.env.R2_PUBLIC_URL ?? ""), {
    message: "URL de imagen inválida",
  }),
```

El `.refine()` contra `R2_PUBLIC_URL` evita que el body de `POST/PATCH
/api/productos` acepte una URL arbitraria de cualquier dominio — el único
origen legítimo para estos campos es el propio endpoint de subida de la
Fase 4. Si `R2_PUBLIC_URL` no está configurado, todo valor no vacío queda
rechazado (fail-safe, no fail-open).

### Fase 6 — Wiring en las rutas de productos existentes

- **`POST /api/productos/route.ts`**: agregar `imagen_url, imagen_url_2` a
  la destructuración de `parsed.data` (línea 50) y al objeto `.insert({...})`
  (líneas 54-72). El `.select("*, categorias(nombre)")` (línea 73) ya trae
  las columnas nuevas sin cambios — `syncProductsToHub` (línea 99-113) ya
  lee `data.imagen_url`, ahora tendrá un valor real por primera vez.
- **`PATCH /api/productos/[id]/route.ts`**:
  - Agregar `if (parsed.data.imagen_url !== undefined) updates.imagen_url = parsed.data.imagen_url;`
    y equivalente para `imagen_url_2`, junto a las líneas 53-69.
  - Después de la actualización exitosa (tras línea 78), comparar
    `productoActual.imagen_url` / `.imagen_url_2` (ya disponibles del
    `select("*")` de la línea 19) contra los nuevos valores. Si cambiaron o
    se limpiaron (`null`), llamar `eliminarImagenProducto()` en
    fire-and-forget con `.catch()` — mismo patrón que `logAudit()` sin
    `await` ya usado en este archivo (líneas 81-92, 100-112) — para no
    dejar objetos huérfanos en R2 cuando se reemplaza o borra una foto.
- **`DELETE /api/productos/[id]/route.ts`** (soft delete, línea 169: `activo:
  false`): **no** borrar los objetos de R2 aquí — el soft delete preserva
  todo el registro para historial/reactivación (mismo principio que el resto
  del soft delete), así que las fotos deben sobrevivir mientras el producto
  pueda reactivarse. Documentar esta decisión explícitamente en el código
  para que no se "corrija" por error más adelante.
- **`GET /api/productos/route.ts`** (línea 21) y **`GET /api/inventario/route.ts`**
  (línea 23): agregar `imagen_url, imagen_url_2` a la lista de columnas
  seleccionadas — sin esto, el listado y el modal de edición no van a poder
  mostrar ni prellenar las fotos existentes.

### Fase 7 — Tipos TypeScript (manual, sin generación automática — `AGENTS.md §0.7`)

- `src/types/index.ts`, interfaz `Producto` (líneas 1-16): agregar
  `imagen_url?: string | null;` y `imagen_url_2?: string | null;`.
- `src/app/(app)/inventory/page.tsx`:
  - Tipo local `Producto` (líneas 23-40): mismos dos campos.
  - `ProductoForm` (líneas 61-77) y `EMPTY_FORM` (líneas 79-85): agregar
    `imagen_url: string | null` / `imagen_url_2: string | null`, inicializados
    en `null`.
  - `abrirEditar()` (líneas 239-257): incluir `imagen_url: p.imagen_url ?? null`
    y `imagen_url_2: p.imagen_url_2 ?? null` al construir el `form`.
  - `mutationFn` de `guardarProducto` (líneas 186-214) y `validate()`
    (líneas 266-296): incluir ambos campos en el `body`/`payload` enviado.

### Fase 8 — UI del formulario

Nuevo componente `src/app/(app)/inventory/components/ProductoImagenesField.tsx`
(2 slots independientes, reutilizable), integrado en el formulario existente
de `inventory/page.tsx`:

- Por cada slot: `input[type=file]` + miniatura de preview (si hay URL) +
  botón "Eliminar" + estado "Subiendo…" mientras la petición está en vuelo.
- Al seleccionar un archivo: `POST /api/productos/imagenes` de inmediato
  (multipart) → la URL devuelta se guarda en `form.imagen_url` /
  `form.imagen_url_2`. Igual que el patrón ya usado por Instagram: sube
  apenas se elige el archivo, no espera al submit del formulario completo.
- Al presionar "Eliminar": si el slot tenía una URL ya subida a R2, llamar
  `DELETE /api/productos/imagenes` con esa URL (limpieza best-effort) y
  luego vaciar el campo del formulario; si el slot está vacío, no hace nada.
- Errores de red o de la API (tipo no permitido, archivo muy pesado, fallo
  de R2) se muestran en el propio slot, no solo en el `formError` genérico
  del formulario.
- El guardado del producto (crear/editar) no cambia de forma — las URLs ya
  están en `form.imagen_url`/`form.imagen_url_2` cuando el usuario hace
  submit, y viajan en el mismo `POST`/`PATCH` de siempre (Fase 6/7).

### Fase 9 — Sincronización con Hub / app móvil

`src/lib/hub-sync.ts` ya declara `imagen_url` en el tipo de
`syncProductsToHub()` (línea 30) — sin cambios, y por primera vez va a viajar
con un valor real. `imagen_url_2` **no** está contemplado en ese payload hoy;
agregarlo es opcional y depende de si el Hub Central / app móvil (repos
externos, no auditados en este análisis) van a consumir una segunda foto —
**fuera de alcance de este plan**, requiere coordinación aparte (§7.4).

### Fase 10 — Tests (obligatorio, `AGENTS.md §19.1` — backend y frontend por separado)

**Backend:**

- `POST /api/productos/imagenes`: 401 sin sesión; tipo de archivo rechazado
  (ej. `application/pdf`); tamaño excedido; éxito devuelve `{ url }` bajo
  `R2_PUBLIC_URL`; el archivo efectivamente pasa por la conversión a WebP
  (mock de `sharp`/cliente R2, no infraestructura real — `AGENTS.md §11.4`).
- `DELETE /api/productos/imagenes`: 401 sin sesión; URL cuya key no
  pertenece al `storeId` de la sesión → rechazada (prueba de aislamiento
  multi-tenant, no solo un 404/200 genérico); éxito.
- `POST`/`PATCH /api/productos`: `imagen_url`/`imagen_url_2` válidos se
  persisten; una URL que no empieza con `R2_PUBLIC_URL` es rechazada por Zod
  (400); reemplazar una imagen existente dispara el borrado de la anterior
  (mock del cliente R2, verificar que se llama con la key correcta).
- `DELETE /api/productos/[id]` (soft delete): verificar que **no** se llama
  al cliente R2 — es una invariante de este diseño, no solo un detalle.

**Frontend (`ProductoImagenesField` y el formulario que lo integra):**

- Render con 0, 1 y 2 fotos existentes, y estado de carga.
- Seleccionar un archivo dispara la llamada real a
  `POST /api/productos/imagenes` (URL, método, `FormData` con el archivo) —
  no basta con que el input exista en el markup.
- "Eliminar" dispara `DELETE /api/productos/imagenes` con la URL correcta y
  limpia el campo del formulario.
- Error de red o de la API (mock de `fetch` con `ok: false`) se refleja en
  el slot correspondiente, no se silencia.
- Guardar el producto (crear y editar) incluye `imagen_url`/`imagen_url_2`
  en el body enviado al backend.

Aplicar el gate de IDs (`AGENTS.md §2.3`): greppear
`docs/spec-registry.md` y `tests/` antes de asignar IDs nuevos, y
registrarlos en el mismo commit.

### Fase 11 — Verificación y cierre

```bash
npm run build && npm test && npm run typecheck && npm run lint
```

Luego `graphify update .` (regla de este repo, `CLAUDE.md` de `app/`) y
cerrar con el formato de `AGENTS.md §22`.

## 5. Riesgos y consideraciones

- **Aislamiento multi-tenant en R2**: las keys de objeto deben incluir
  `storeId` como prefijo (`productos/{storeId}/...`) y **todo borrado debe
  validar ese prefijo antes de ejecutar `DeleteObjectCommand`** — sin este
  chequeo, conocer o adivinar la URL de otra tienda permitiría borrar su
  archivo. Es el mismo tipo de control que `AGENTS.md §6` exige para
  `store_id` en Postgres, aplicado aquí a claves de objeto en R2.
- **Archivos huérfanos**: como la subida ocurre al seleccionar el archivo
  (no al guardar el producto, ver Fase 8), cancelar el formulario después de
  subir una foto puede dejar un objeto en R2 sin producto asociado. Mitigado
  parcialmente por el botón "Eliminar" (que sí borra el objeto recién
  subido); el caso residual — cerrar la pestaña sin cancelar explícitamente
  — queda como riesgo documentado y de bajo impacto (costo de storage), no
  bloqueante para esta primera versión. Si el volumen de huérfanos resulta
  significativo en la práctica, la mitigación futura natural es un job de
  limpieza que compare objetos en R2 contra `productos.imagen_url` /
  `imagen_url_2` — no está en el alcance de este plan.
- **Costos**: R2 no cobra egress, pero sí operaciones Class A (`PutObject`)
  y almacenamiento. El resize a máx. 1200px + WebP calidad 80 mantiene el
  tamaño típico bajo, pero no hay un límite duro más allá del tamaño máximo
  de entrada (§7.3).
- **Falla de conversión**: si `sharp` no logra decodificar el archivo
  (corrupto, formato no soportado pese a pasar el whitelist de
  `Content-Type`), el endpoint debe devolver 400 explícito — nunca subir el
  original sin optimizar como fallback silencioso.
- **Runtime Node.js**: el endpoint de subida depende de `sharp` (nativo,
  Node-only) — no debe agregarse `export const runtime = "edge"` a ese
  `route.ts` en ningún cambio futuro.

## 6. Decisiones que quedan abiertas (bloquean partes de la implementación)

| # | Decisión pendiente | Bloquea |
|---|---------------------|---------|
| 7.1 | Dominio propio a conectar en R2 Custom Domain — aún no definido | Fase 0 y el valor real de `R2_PUBLIC_URL`; sin esto no hay URL pública que guardar. |
| 7.2 | Generación y carga de `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (quién las crea en el dashboard de Cloudflare y dónde se cargan en Vercel) | Fase 4 en producción. |
| 7.3 | Tamaño máximo de archivo de entrada aceptado — propuesta 8 MB (mismo orden que los 10 MB de `instagram/upload`) | Confirmar antes de fijar la constante en Fase 4. |
| 7.4 | Si `imagen_url_2` debe sincronizarse al Hub Central / app móvil, o si por ahora solo consumen la primera foto | Depende de un repositorio externo no auditado en este análisis — fuera de alcance mientras no se confirme. |

## 7. Fuera de alcance de este plan

- Cambios en el repositorio del Hub Central o la app móvil.
- Migración retroactiva de fotos que pudieran existir en otro sistema (no
  hay evidencia de que existan — `imagen_url` nunca tuvo escritor real, §1).
- Editor de imagen en el cliente (recorte, rotación) — solo redimensionado
  automático del lado del servidor.
- Job de limpieza automática de archivos huérfanos en R2 (ver riesgo en §5).
