# Plan: Servicios agendables (Peluquería y similares)

Estado: **Fase 1 y Fase 2 implementadas y aplicadas** (migraciones 063-066
en `wnxrdbnvreofrrmhcybc`, revisadas y verificadas — ver §0 y §18). Este
documento ya no es solo un plan de análisis; documenta también lo
efectivamente construido.

## Fase 1 — Configuración administrativa (implementada)

Admin de tienda configura servicios ofrecidos (ej. "Peluquería — Corte
básico", 30 min) y su horario semanal habilitado (días Lun–Dom, hora
inicio/fin por día). Es solo catálogo/configuración — sin lógica de citas.

## Fase 2 — Citas de clientes (implementada — diseño completo en §9 en adelante)

Citas de clientes contra los servicios de Fase 1: disponibilidad, prevención
de conflictos bajo concurrencia, cancelaciones y excepciones/feriados. Ver
§9-§18 más abajo.

---

## 1. Decisiones de modelo de datos

No había preguntas abiertas preexistentes que resolver con el usuario en
tiempo real — el documento original (versión previa de este mismo archivo)
dejaba 3 decisiones de diseño pendientes; estas son las respuestas con
recomendación concreta, **ya revisadas**. Ninguna se aplica sin confirmación
explícita — esto incluye ejecutar la migración 063 contra el único proyecto
real (`wnxrdbnvreofrrmhcybc`, sin staging, AGENTS.md §0.1/§11.2).

### 1a. ¿Un servicio tiene una duración fija única, o puede ofrecer variantes (30/60/90 min)?

**Decisión: fila por variante.** "Peluquería — Corte básico" (30 min) y
"Peluquería — Corte completo" (60 min) son dos filas distintas en
`servicios`, cada una con su propio `duracion_minutos`. No se crea tabla
`servicio_duraciones`.

Justificación: es el mismo patrón que ya usa `productos` para variantes de
catálogo (una fila por variante, no una tabla de variantes aparte). Evita
resolver ahora preguntas sin requisito claro (¿comparten nombre público?
¿precio por variante?) que Fase 2 tampoco ha definido. No bloquea Fase 2: una
cita simplemente referencia `servicio_id` (una fila = una duración fija). Es
aditivo si más adelante se necesita compartir metadata entre variantes.

### 1d. ¿`duracion_minutos` es un rango libre o un enum cerrado?

**Decisión: enum cerrado `{30, 60, 90}`.** `CHECK (duracion_minutos IN (30,
60, 90))` en la BD, mismo enum en Zod y `<select>` (no input numérico) en
la UI.

Justificación: es el requisito literal del usuario en la solicitud
original — "la duración del servicio (**puede ser 30, 60 y 90 minutos**)".
La primera implementación de este plan lo dejó como rango libre 5-480 min
(`CHECK (duracion_minutos > 0 AND duracion_minutos <= 480)`), lo que
excedía lo pedido — corregido en revisión antes de aplicar la migración
(sin datos existentes que migrar, el cambio fue gratis). No es una
decisión de diseño abierta como 1a/1b/1c: es una corrección de fidelidad
contra un requisito ya explícito.

### 1b. ¿`servicio_horarios` permite múltiples franjas por día (mañana/tarde) o solo una franja continua?

**Decisión: una única franja por día de la semana.** Constraint
`UNIQUE (servicio_id, dia_semana)`.

Justificación: el requisito de negocio dice "horario de inicio/fin **por
día habilitado**" (singular), no franjas. Multi-franja obliga a resolver
ahora validación de solapamiento entre franjas del mismo día sin que exista
requisito — especulación sobre Fase 2 (YAGNI). Es aditivo: pasar a N
franjas por día después es quitar el `UNIQUE` y agregar orden, sin rehacer
el modelo ni migrar citas (que en Fase 1 no existen todavía). Efecto
colateral positivo: con esta decisión, la única validación de rango
necesaria en Fase 1 es `hora_inicio < hora_fin` — no hace falta un
algoritmo de detección de solapamiento de rangos.

### 1c. ¿Se diseñan ya excepciones/feriados (días puntuales que sobreescriben el horario semanal)?

**Decisión: diferir completamente a Fase 2.** Ninguna tabla, columna ni
mención en la UI de Fase 1.

Justificación (YAGNI explícito): una excepción de feriado solo tiene
sentido operacional una vez que existen citas que pueden verse afectadas
(¿se cancelan automático? ¿se notifica?). Sin Fase 2 definida, cualquier
modelo de excepciones hoy sería inventado. Es trivial de agregar después
(`servicio_excepciones(servicio_id, fecha, cerrado, hora_inicio?,
hora_fin?)`) sin tocar `servicios` ni `servicio_horarios`.

---

## 2. Migración SQL borrador — `migrations/063_servicios.sql`

**No aplicar sin confirmación explícita** (AGENTS.md §11.2 — no hay
staging, `wnxrdbnvreofrrmhcybc` es el único proyecto real). Mecanismo
preferido: `mcp__supabase__apply_migration` si está disponible; si no, el
medio que autorice el usuario.

```sql
-- migrations/063_servicios.sql
-- Fase 1 de "servicios agendables": configuración administrativa pura
-- (nombre, duración, horario semanal habilitado). NO incluye citas/reservas
-- de clientes, disponibilidad calculada ni excepciones/feriados — eso es
-- Fase 2, deliberadamente fuera de este alcance (ver docs/plan_servicios.md §8).
--
-- Modelo (decisiones documentadas en §1 de este plan):
--   servicios         — catálogo de servicios ofrecidos por la tienda. Una
--                        fila por VARIANTE de duración (ej. "Corte básico"
--                        30min y "Corte completo" 60min son dos filas, no
--                        una fila con múltiples duraciones) — decisión §1a.
--   servicio_horarios — a lo sumo UNA franja horaria por día de la semana
--                        por servicio (sin franjas partidas mañana/tarde en
--                        Fase 1) — decisión §1b. dia_semana usa convención
--                        ISO 8601: 1=Lunes ... 7=Domingo (NO la convención
--                        EXTRACT(DOW) de Postgres, que usa 0=Domingo).
--
-- store_id se duplica en servicio_horarios (en vez de resolverse solo vía
-- JOIN a servicios) a propósito: toda tabla tenant-scoped debe poder
-- filtrarse directamente con .eq("store_id", storeId) sin depender de un
-- JOIN (defensa en profundidad, ya que RLS no está en la ruta real de
-- ejecución — el service role la salta, AGENTS.md §0.2). Esto difiere del
-- patrón antiguo de venta_items/nota_credito_items (§6.3 de AGENTS.md), que
-- sí dependen de JOIN al padre por no tener store_id propio; aquí se sigue
-- el patrón más estricto para tabla nueva.
--
-- Patrón RLS: get_user_store_id() OR is_system_admin() (vigente desde la
-- migración 062), vía DO/EXCEPTION porque CREATE POLICY IF NOT EXISTS no
-- existe en Postgres.

-- ─── SERVICIOS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS servicios (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  nombre           TEXT         NOT NULL CHECK (char_length(nombre) BETWEEN 2 AND 100),
  descripcion      TEXT         CHECK (char_length(descripcion) <= 500),
  duracion_minutos INTEGER      NOT NULL CHECK (duracion_minutos IN (30, 60, 90)), -- enum cerrado, ver decisión §1d
  activo           BOOLEAN      NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_servicios_store_id ON servicios(store_id);

ALTER TABLE servicios ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "servicios_store_isolation" ON servicios
    FOR ALL USING (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_servicios_updated_at
    BEFORE UPDATE ON servicios
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── SERVICIO_HORARIOS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS servicio_horarios (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  servicio_id UUID         NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  dia_semana  INTEGER      NOT NULL CHECK (dia_semana BETWEEN 1 AND 7), -- 1=Lunes ... 7=Domingo (ISO 8601)
  hora_inicio TIME         NOT NULL,
  hora_fin    TIME         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CHECK (hora_inicio < hora_fin),
  UNIQUE (servicio_id, dia_semana)
);

CREATE INDEX IF NOT EXISTS idx_servicio_horarios_store_id    ON servicio_horarios(store_id);
CREATE INDEX IF NOT EXISTS idx_servicio_horarios_servicio_id ON servicio_horarios(servicio_id);

ALTER TABLE servicio_horarios ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "servicio_horarios_store_isolation" ON servicio_horarios
    FOR ALL USING (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_servicio_horarios_updated_at
    BEFORE UPDATE ON servicio_horarios
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── RPC: reemplazo atómico del horario semanal de un servicio ─────────────
-- Usada por PUT /api/servicios/[id]/horarios. DELETE + INSERT dentro de una
-- sola función (transaccional) para no dejar el horario en estado parcial
-- si el reemplazo falla a mitad de camino (ej. dos pestañas del admin
-- editando a la vez).
CREATE OR REPLACE FUNCTION replace_servicio_horarios(
  p_servicio_id UUID,
  p_store_id    UUID,
  p_horarios    JSONB  -- array de {dia_semana, hora_inicio, hora_fin}, ya validado por Zod en la API
) RETURNS SETOF servicio_horarios AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM servicios WHERE id = p_servicio_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Servicio % no encontrado para la tienda %', p_servicio_id, p_store_id
      USING ERRCODE = 'P0002'; -- la API mapea este código a 404
  END IF;

  DELETE FROM servicio_horarios
  WHERE servicio_id = p_servicio_id AND store_id = p_store_id;

  RETURN QUERY
  INSERT INTO servicio_horarios (store_id, servicio_id, dia_semana, hora_inicio, hora_fin)
  SELECT p_store_id, p_servicio_id,
         (elem->>'dia_semana')::INTEGER,
         (elem->>'hora_inicio')::TIME,
         (elem->>'hora_fin')::TIME
  FROM jsonb_array_elements(p_horarios) AS elem
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION replace_servicio_horarios TO service_role;
```

> Nota de implementación (Postgres → JS): las columnas `TIME` se
> serializan por supabase-js como texto `"HH:MM:SS"` al leer (aunque se
> inserten como `"HH:MM"`). La API/UI deben normalizar (`.slice(0,5)`) al
> mostrar en un `<input type="time">`. Cubrir con test — ver I-SRV-26.
> **Clasificación de evidencia (§1.1 AGENTS.md): inferido, no verificado.**
> Es comportamiento estándar y documentado de PostgREST para el tipo `time`,
> pero no hay ninguna columna `TIME` existente en este schema para
> contrastarlo empíricamente contra la instancia real. Confirmar con una
> lectura real no destructiva apenas exista la tabla, antes de dar el test
> I-SRV-26 por representativo del comportamiento en producción.

> **Desviación de precedente — decidida con el usuario: se adopta `ERRCODE`.**
> El mapeo de error del RPC usa `RAISE EXCEPTION ... USING ERRCODE = 'P0002'`
> (código estándar `NO_DATA_FOUND` de PL/pgSQL) y la API mapea
> `error.code === "P0002"` → 404. El precedente real del repo (`PATCH
> /api/ventas/[id]` consumiendo `anular_venta_tx`, migración 053) usa en
> cambio `txError.message.includes("no encontrada")` — matching por
> substring del mensaje. Se decidió deliberadamente NO seguir ese
> precedente para este RPC nuevo: `ERRCODE` es más robusto (no se rompe si
> cambia el texto o el idioma del mensaje de error) y es la forma
> correcta/idiomática de señalizar un error tipado desde PL/pgSQL. Queda
> como el patrón a usar en este cambio; no implica migrar
> `anular_venta_tx`/`crear_nota_credito_tx` al mismo estilo — eso, si se
> hace, es una decisión aparte y no se toca en este plan.

## 3. Contrato de API

Patrón de auth uniforme: `getStoreId()` (de `src/lib/auth.ts`) para 401 +
resolver `storeId`; para escritura, además `auth()` de Clerk +
`getAdminStatus(sessionClaims)` + `try { requireStoreAdmin(admin, ctx.storeId) } catch { return 403 }`
(patrón `settings/route.ts`, más robusto que la extracción manual de
`sessionClaims.publicMetadata` que hace hoy `categorias/route.ts`).

### `GET /api/servicios` — `src/app/api/servicios/route.ts`
- Auth: cualquier usuario autenticado de la tienda (`getStoreId()`, sin admin-check).
- Query: `.from("servicios").select("id, nombre, descripcion, duracion_minutos, activo").eq("store_id", storeId).eq("activo", true).order("nombre")`.
- 200 → `Servicio[]` (array directo). 401 sin sesión. 500 error de DB.

### `POST /api/servicios` — mismo archivo
- Auth: admin (`requireStoreAdmin`).
- Body: `ServicioCreateSchema` → `{ nombre, descripcion?, duracion_minutos }`.
- Insert: `{ store_id: ctx.storeId, nombre: trim, descripcion: trim||null, duracion_minutos }` — `store_id` siempre del contexto autenticado, el schema ni acepta ese campo del body.
- 201 con la fila creada. 400 Zod. 403 sin rol admin. 409 si `error.code === "23505"` → `{error: "Ya existe un servicio con ese nombre"}`. 500 otro error.
- `logAudit({action:"CREATE", entityType:"servicio", ...})` fire-and-forget `.catch(()=>{})` (patrón `categorias`).

### `GET /api/servicios/[id]` — `src/app/api/servicios/[id]/route.ts`
- Auth: cualquier usuario autenticado de la tienda.
- Query: `.from("servicios").select("*, servicio_horarios(*)").eq("id", id).eq("store_id", storeId).single()`.
- 200 → `ServicioConHorarios` (horarios reordenados por `dia_semana` en el handler — el embed de Supabase no garantiza orden). 404 si `error.code === "PGRST116"`. 401 sin sesión.

### `PATCH /api/servicios/[id]` — mismo archivo
- Auth: admin.
- Body: `ServicioUpdateSchema` → todos opcionales `{ nombre?, descripcion?, duracion_minutos?, activo? }`.
- Update parcial (`if (x !== undefined) updates.x = x`), `.eq("id", id).eq("store_id", ctx.storeId)` (defensa en profundidad además del admin check).
- Fetch previo de la fila para `oldValues` de auditoría.
- 200 con fila actualizada. 400 Zod. 403. 404 (`PGRST116` — servicio de otra tienda). 409 nombre duplicado.
- `logAudit({action:"UPDATE", entityType:"servicio", oldValues, newValues: updates})` fire-and-forget.

### `DELETE /api/servicios/[id]` — mismo archivo
- Auth: admin.
- Soft delete: `.update({ activo: false }).eq("id", id).eq("store_id", ctx.storeId)`. No hay DELETE real (patrón `categorias`).
- Fetch previo para `oldValues`; 404 si no existe.
- 204 sin body. `logAudit({action:"DELETE", ...})` fire-and-forget.
- El soft delete de `servicios` no toca `servicio_horarios` — quedan intactos y vuelven a aplicar si el servicio se reactiva.

### `GET /api/servicios/[id]/horarios` — `src/app/api/servicios/[id]/horarios/route.ts`
- Auth: cualquier usuario autenticado de la tienda.
- Verifica primero que el servicio pertenece a la tienda (`select id from servicios where id=id and store_id=storeId`) → 404 si no.
- `.from("servicio_horarios").select("*").eq("servicio_id", id).eq("store_id", storeId).order("dia_semana")`.
- 200 → `ServicioHorario[]` (0 a 7 filas).

### `PUT /api/servicios/[id]/horarios` — mismo archivo (reemplazo total, no PATCH incremental)
- Auth: admin.
- Body: `ServicioHorariosReplaceSchema` → `{ horarios: [{dia_semana, hora_inicio, hora_fin}, ...] }` (máx 7, sin día repetido, cada franja `hora_inicio < hora_fin`).
- Llama `supabase.rpc("replace_servicio_horarios", { p_servicio_id: id, p_store_id: ctx.storeId, p_horarios: parsed.data.horarios })`.
- Si `error.code === "P0002"` (RAISE del RPC, ver §2) → 404 "Servicio no encontrado". Otro error → 500.
- 200 con las filas resultantes ordenadas por `dia_semana`. 400 Zod. 403.
- `logAudit({action:"UPDATE", entityType:"servicio_horarios", entityId: id, newValues: {horarios: parsed.data.horarios}})` fire-and-forget.

Decisión explícita: no hay endpoints granulares (POST/DELETE de una franja
individual) en Fase 1. La UI siempre envía la grilla semanal completa;
"reemplazo total" evita estados intermedios inconsistentes y el RPC lo hace
atómico.

## 4. Tipos TypeScript — agregar al final de `src/types/index.ts`

```typescript
export interface Servicio {
  id: string;
  store_id: string;
  nombre: string;
  descripcion?: string | null;
  duracion_minutos: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

// 1=Lunes ... 7=Domingo (ISO 8601) — NO usar la convención EXTRACT(DOW) de Postgres
export type DiaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ServicioHorario {
  id: string;
  store_id: string;
  servicio_id: string;
  dia_semana: DiaSemana;
  hora_inicio: string; // "HH:MM:SS" tal como lo serializa Postgres TIME al leer
  hora_fin: string;
  created_at: string;
  updated_at: string;
}

export interface ServicioConHorarios extends Servicio {
  servicio_horarios: ServicioHorario[];
}
```

## 5. Schemas Zod — nuevo `src/lib/validation/servicios.ts`

```typescript
import { z } from "zod";

// Regex local (no en primitives.ts): mismo precedente que el regex de fecha
// en inventario.ts, tampoco centralizado — nada más lo usa hoy (YAGNI).
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:MM 24h

// Requisito explícito del usuario: "la duración del servicio (puede ser 30,
// 60 y 90 minutos)". Enum cerrado, NO un rango libre — decisión §1d.
const DURACION_MINUTOS_VALIDAS = [30, 60, 90] as const;
const DuracionMinutosSchema = z
  .number()
  .refine((v): v is 30 | 60 | 90 => (DURACION_MINUTOS_VALIDAS as readonly number[]).includes(v), {
    message: "La duración debe ser 30, 60 o 90 minutos",
  });

export const ServicioCreateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  descripcion: z.string().max(500).optional(),
  duracion_minutos: DuracionMinutosSchema,
});

export const ServicioUpdateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100).optional(),
  descripcion: z.string().max(500).optional(),
  duracion_minutos: DuracionMinutosSchema.optional(),
  activo: z.boolean().optional(),
});

export const DiaSemanaSchema = z
  .number()
  .int("El día de la semana debe ser un entero")
  .min(1, "El día de la semana debe estar entre 1 (Lunes) y 7 (Domingo)")
  .max(7, "El día de la semana debe estar entre 1 (Lunes) y 7 (Domingo)");

export const ServicioHorarioItemSchema = z
  .object({
    dia_semana: DiaSemanaSchema,
    hora_inicio: z.string().regex(HORA_REGEX, "Formato de hora inválido (use HH:MM)"),
    hora_fin: z.string().regex(HORA_REGEX, "Formato de hora inválido (use HH:MM)"),
  })
  .refine((d) => d.hora_inicio < d.hora_fin, {
    message: "La hora de inicio debe ser anterior a la hora de fin",
    path: ["hora_fin"],
  });

export const ServicioHorariosReplaceSchema = z
  .object({
    horarios: z.array(ServicioHorarioItemSchema).max(7, "No puede haber más de 7 franjas (una por día)"),
  })
  .refine(
    (d) => new Set(d.horarios.map((h) => h.dia_semana)).size === d.horarios.length,
    { message: "No puede repetirse el mismo día de la semana", path: ["horarios"] }
  );
```

Nota: `hora_inicio < hora_fin` es comparación lexicográfica de strings —
correcta solo porque el regex ya garantizó formato `HH:MM` de ancho fijo
(Zod ejecuta el `.refine()` de objeto solo si el parseo de campos base tuvo
éxito).

Agregar en `src/lib/validation.ts` (barrel, confirmado que solo re-exporta
`primitives | clientes | inventario | ventas | supply-chain | admin` hoy):

```typescript
export * from "./validation/servicios";
```

## 6. Desglose de tareas — orden y archivos exactos

1. **Migración** — crear `migrations/063_servicios.sql` (§2). No aplicar sin confirmación explícita del usuario (§1).
2. **Tipos** — editar `src/types/index.ts`: agregar `Servicio`, `DiaSemana`, `ServicioHorario`, `ServicioConHorarios` (§4).
3. **Zod** — crear `src/lib/validation/servicios.ts` (§5); editar `src/lib/validation.ts` agregando el `export *`.
4. **API**:
   - Crear `src/app/api/servicios/route.ts` (GET, POST).
   - Crear `src/app/api/servicios/[id]/route.ts` (GET, PATCH, DELETE).
   - Crear `src/app/api/servicios/[id]/horarios/route.ts` (GET, PUT).
5. **UI admin**:
   - Crear `src/app/(app)/servicios/page.tsx` (página propia, no un redirect como `categorias/page.tsx`).
   - Crear `src/app/(app)/servicios/components/ServiciosTab.tsx` — listado + crear/editar/(soft)eliminar, calcado del patrón `CategoriasTab.tsx` (`useQuery`/`useMutation` con fetch directo, sin capa de hooks separada).
   - Crear `src/app/(app)/servicios/components/HorarioSemanalEditor.tsx` — grilla de 7 días (checkbox habilitado + hora inicio/fin), hace `PUT /api/servicios/[id]/horarios` con el array completo vía `useMutation`.
   - Editar `src/app/(app)/layout.tsx`: agregar al array `navItems` (confirmado en líneas 10-22) `{ href: "/servicios", label: "Servicios", roles: ["storeAdmin", "systemAdmin"] }`, después de `/inventory`.
6. **Tests** (detalle en §7):
   - Crear `tests/integration/api/servicios.test.ts`.
   - Editar `tests/unit/lib/validation.test.ts`: agregar `describe` para los 4 schemas nuevos.
   - Editar `tests/unit/lib/property-invariants.test.ts`: agregar bloque `PROP-04`.
   - Editar `docs/spec-registry.md`: sección "Servicios (I-SRV-01 a I-SRV-28)", sección de validación (U-SRV-01 a U-SRV-12), registrar `PROP-04`, y agregar `I-SRV-NN`/`U-SRV-NN` a "Convención de IDs" — en el mismo commit que los tests (AGENTS.md §2 gate 3).

## 7. Plan de pruebas — IDs asignados

Sub-prefijos propios `I-SRV-NN`/`U-SRV-NN` (mismo patrón confirmado que
`I-CAT-NN`, `I-REC-NN`, `I-NCC-NN`; no consumen el contador plano `I-NNN`
genérico). `PROP-04` es el próximo disponible (confirmado: existen
`PROP-01` a `PROP-03`). Los casos de autorización/rol se integran dentro de
`I-SRV-NN` en un `describe("... — control de acceso por rol")`, igual que
`categorias.test.ts` (no se usa `SEC-09`/`SEC-10` — confirmado que ese es
el precedente real del repo: `I-CAT-04`/`I-CAT-05` cubren 401/403 dentro
del mismo prefijo, no uno aparte).

### Integración — `tests/integration/api/servicios.test.ts`

**`GET /api/servicios`**
- `I-SRV-01` sin sesión → 401
- `I-SRV-02` autenticado sin rol admin → 200 con array (lectura abierta a cualquier rol de la tienda)
- `I-SRV-03` filtra por `store_id` (assert `.eq("store_id", STORE_ID)`)
- `I-SRV-04` error de DB → 500

**`POST /api/servicios`**
- `I-SRV-05` sin sesión → 401
- `I-SRV-06` rol worker (sin admin) → 403
- `I-SRV-07` `duracion_minutos: 0` → 400
- `I-SRV-08` body con `store_id` de otra tienda → se ignora, persiste con `store_id` del contexto → 201
- `I-SRV-09` nombre duplicado en la misma tienda (mock `error.code: "23505"`) → 409
- `I-SRV-10` payload válido → 201

**`GET /api/servicios/[id]`**
- `I-SRV-11` servicio de otra tienda (mock `PGRST116`) → 404
- `I-SRV-12` servicio existente → 200 con `servicio_horarios` anidado

**`PATCH /api/servicios/[id]`**
- `I-SRV-13` sin sesión → 401
- `I-SRV-14` rol worker → 403
- `I-SRV-15` servicio de otra tienda → 404
- `I-SRV-16` PATCH sin `descripcion` no la modifica (solo cambia `activo`)
- `I-SRV-17` `duracion_minutos` inválida → 400

**`DELETE /api/servicios/[id]`**
- `I-SRV-18` soft delete: assert `update({activo:false})`, nunca `.delete()`
- `I-SRV-19` servicio de otra tienda → 404

**`GET /api/servicios/[id]/horarios`**
- `I-SRV-20` servicio de otra tienda → 404
- `I-SRV-21` servicio sin horarios configurados → 200 array vacío

**`PUT /api/servicios/[id]/horarios`**
- `I-SRV-22` sin sesión → 401
- `I-SRV-23` rol worker → 403
- `I-SRV-24` algún día con `hora_inicio >= hora_fin` → 400
- `I-SRV-25` día repetido en el array → 400 (constraint de unicidad, §1b)
- `I-SRV-26` payload válido (7 días, franjas válidas) → 200; assert `supabase.rpc("replace_servicio_horarios", {p_store_id: STORE_ID, ...})` con `p_store_id` del contexto, no del body; incluye assert de normalización `"HH:MM:SS"` → `"HH:MM"` en la respuesta (ver caveat de evidencia en §2)
- `I-SRV-27` servicio de otra tienda → 404 (mock RPC con `error.code: "P0002"`)
- `I-SRV-28` array vacío → 200 (limpia el horario completo, estado válido)

### Unit Zod — agregar a `tests/unit/lib/validation.test.ts`

- `describe("ServicioCreateSchema")`: `U-SRV-01` payload válido → success; `U-SRV-02` nombre 1 carácter → fail; `U-SRV-03` `duracion_minutos: 0` → fail; `U-SRV-04` `duracion_minutos: 481` → fail; `U-SRV-05` `duracion_minutos: 45.5` → fail (no está en el enum); `U-SRV-13` `duracion_minutos: 45` (entero válido pero fuera del enum) → fail; `U-SRV-14`/`U-SRV-15` `60`/`90` → success. Integración: `I-SRV-29` `duracion_minutos: 45` → 400.
- `describe("ServicioHorarioItemSchema")`: `U-SRV-06` `"09:00"`→`"18:00"` → success; `U-SRV-07` `"18:00"`→`"09:00"` → fail; `U-SRV-08` formatos inválidos (`"9:00"`, `"25:00"`, `"09:60"`) → fail; `U-SRV-09` `dia_semana: 0` y `8` → fail.
- `describe("ServicioHorariosReplaceSchema")`: `U-SRV-10` día repetido → fail; `U-SRV-11` array de 8 elementos → fail; `U-SRV-12` array vacío → success.

### Property — agregar a `tests/unit/lib/property-invariants.test.ts`

```typescript
describe("PROP-04: servicio_horarios — invariante hora_inicio < hora_fin", () => {
  it("hora_inicio < hora_fin siempre aceptado; hora_inicio >= hora_fin siempre rechazado", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }),
        (h1, m1, h2, m2) => {
          const pad = (n: number) => String(n).padStart(2, "0");
          const inicio = `${pad(h1)}:${pad(m1)}`;
          const fin = `${pad(h2)}:${pad(m2)}`;
          const result = ServicioHorarioItemSchema.safeParse({ dia_semana: 1, hora_inicio: inicio, hora_fin: fin });
          expect(result.success).toBe(inicio < fin);
        }
      )
    );
  });
});
```

## 8. Fase 1 completa — a partir de aquí, diseño e implementación de Fase 2 (§9 en adelante)

Todo lo de §1-§7 es Fase 1, implementada y aplicada (migración 063). Lo que
sigue (§9-§17) es el diseño completo de Fase 2 (citas reales de clientes),
también implementado y aplicado (migración 066). Fase 2 dependía de que
Fase 1 ya estuviera implementada — las tablas `servicios` y
`servicio_horarios`, y las funciones `get_user_store_id()`,
`is_system_admin()`, `update_updated_at()` eran prerequisito directo.

---

## 9. Fase 2 — Alcance asumido y decisiones de diseño — ✅ APROBADAS por el usuario (2026-08-02)

Antes de diseñar se preguntó explícitamente (a) quién reserva las citas y (b)
qué subconjunto de "todo lo de Fase 2" se quería completo. El usuario aprobó
avanzar con las opciones recomendadas por defecto (§9a-§9g), y confirmó
implementar y aplicar la migración correspondiente.

### 9a. ¿Quién crea una cita? — solo staff, vía panel interno

La cita la agenda el personal de la tienda (`storeWorker`/`storeAdmin`) desde
el panel autenticado con Clerk, igual que una venta se registra desde el POS
— no hay autoservicio del cliente (reserva pública sin login) en Fase 2. Si
se necesita autoservicio, es un cambio de superficie de seguridad importante
(autenticación distinta, rate limiting, verificación de identidad sin Clerk)
que se deja para Fase 3 (§17).

### 9b. Alcance de "Fase 2 completa" — core + cancelaciones + excepciones/feriados

Se diseñó e implementó completo: tabla `citas`, cálculo de disponibilidad,
prevención de conflictos de horario, cancelaciones (sin política de
anticipación mínima obligatoria — ver 9f), y excepciones/feriados (la
decisión que Fase 1 §1c difirió explícitamente).

Queda fuera, movido a "Fase 3" (§17): notificaciones/recordatorios,
multi-profesional, buffer time entre citas, integración con POS/canales
externos, vista de calendario/agenda visual, y autoservicio del cliente.

### 9c. Mecanismo de prevención de conflictos bajo concurrencia — `pg_advisory_xact_lock`, no `EXCLUDE`/`btree_gist`

**Decisión: bloqueo consultivo (`pg_advisory_xact_lock`) dentro de la función
`crear_cita_tx`, keyed por `(servicio_id, fecha)`.**

Investigación puntual sobre el repo real: `grep` exhaustivo de
`EXCLUDE|GIST|btree_gist|tsrange|tstzrange` sobre `migrations/*.sql` da **0
resultados** — no hay ningún precedente de exclusion constraints de rango
temporal en este proyecto. El patrón que sí existe, repetido en
`crear_venta_tx`, `anular_venta_tx` (053), `crear_nota_credito_tx` (061) y las
funciones de `saldos_a_favor` (051, ver AGENTS.md §23.6), es: función
`plpgsql` con reclamo atómico de un recurso, sin exclusion constraints
declarativos. Se sigue ese patrón en vez de introducir `CREATE EXTENSION
btree_gist` + `EXCLUDE USING gist (...)`, que sería la primera vez en el
proyecto.

Detalle del problema que resuelve el lock: sin él, dos requests concurrentes
para el mismo `servicio_id`+`fecha` podrían ambos ejecutar el `SELECT` de
conflicto de horario, ver "sin conflicto" (ninguno ve todavía la fila que el
otro está por insertar, bajo el nivel de aislamiento READ COMMITTED por
defecto de Postgres), y ambos insertar — citas solapadas.
`pg_advisory_xact_lock(hashtextextended(servicio_id::text || fecha::text, 0))`
serializa los intentos concurrentes sobre esa combinación específica; se
libera automáticamente al terminar la transacción (commit o rollback), sin
dejar el lock colgado ante un error.

Alternativa descartada: `EXCLUDE USING gist (servicio_id WITH =, tstzrange(...) WITH &&)`
es la solución "de libro" en Postgres para este problema, y más robusta en
general (protege incluso contra un `INSERT` directo que se salte la función,
cosa que el advisory lock no hace). Se descarta por ahora porque: (a) requiere
una extensión no usada en el proyecto, (b) el resto del código nunca protege
sus invariantes de concurrencia así — todas usan funciones `plpgsql`, y (c)
como todas las escrituras pasan por `createServiceClient()` sin excepción
(§0.2 de AGENTS.md), no hay un camino real de "insert directo que se salte la
función" que el `EXCLUDE` proteja y el advisory lock no. Si en el futuro se
habilita escritura directa a la tabla desde otro lugar (ej. un backfill, un
script), reevaluar.

### 9d. `mascota_id` — opcional, no obligatorio

Una cita requiere `cliente_id` (no tiene sentido una cita sin cliente), pero
`mascota_id` queda nullable. Razonamiento: Fase 1 no definió el catálogo de
servicios más allá de "Peluquería" como ejemplo — forzar `mascota_id`
obligatorio asumiría que todo servicio futuro aplica a una mascota específica,
lo cual el catálogo de Fase 1 no garantiza. La UI puede exigirlo por UX para
servicios de peluquería sin que sea un `NOT NULL` a nivel de base de datos.

### 9e. Estados de la cita: 4 valores (`confirmada`, `cancelada`, `completada`, `no_show`)

Se incluyen los 4 desde ahora (no solo `confirmada`/`cancelada`) porque el
costo de agregarlos es solo un `CHECK` con más valores — no traen infraestructura
adicional (no hay automatización de no-show, ni notificación de completado;
son transiciones manuales que el staff hace después de la cita). Se evita así
una migración de columna después solo para agregar dos valores a un enum de
texto. No hay estado `pendiente`: al no haber autoservicio (9a), toda cita
creada por staff queda `confirmada` de inmediato — no hay flujo de aprobación.

### 9f. Cancelación: libre por staff, sin política de anticipación mínima obligatoria

Dado que solo el staff cancela (9a), no hay necesidad de una regla de
anticipación mínima a nivel de sistema — el criterio queda en el personal.
Se registra obligatoriamente `motivo_cancelacion` y el actor (`cancelado_por`,
`cancelado_at`) para trazabilidad. Si se habilita autoservicio de cliente en
Fase 3, ahí sí se necesitará una política configurable (§17).

### 9g. No se ofrece "reagendar" atómico — cancelar + crear nueva

Mover una cita a otro horario no es una operación separada en Fase 2:
se cancela la cita existente (con motivo, ej. "reagendada") y se crea una
nueva vía `crear_cita_tx`. Esto reutiliza toda la lógica de validación de
conflicto/horario sin duplicarla en un tercer flujo de "update de fecha/hora",
a costa de perder la trazabilidad de "esta cita es la continuación de
aquella" (dos filas sin vínculo explícito). Si esa trazabilidad importa,
Fase 3 puede agregar un campo `reagendada_desde_id` sin tocar el resto del
diseño.

---

## 10. Fase 2 — Migración SQL — `migrations/066_citas.sql` (aplicada)

Requería que `migrations/063_servicios.sql` (Fase 1) ya estuviera aplicada.
Numeración real: el diseño original llamaba a este archivo `064_citas.sql`,
pero 064/065 quedaron ocupadas por las migraciones de `REVOKE` de Fase 1
(fix del advisor de seguridad, ver §0). Se numeró `066`.

**Desviación aprobada respecto al diseño original de §10:** se incluyeron
`REVOKE EXECUTE ... FROM PUBLIC` y `FROM anon, authenticated` directamente en
la misma migración para `crear_cita_tx` y `cancelar_cita_tx` — Supabase
otorga `EXECUTE` a `anon`/`authenticated` como grant directo en funciones
nuevas del schema `public` (hallazgo verificado al aplicar 063/064/065, ver
§0). Se evitó así repetir el ciclo "aplicar → advisor flaggea → migración de
revoke" que ocurrió en Fase 1. Verificado tras aplicar: `pg_proc.proacl` de
ambas funciones solo lista `postgres`/`service_role`; `get_advisors`
confirma que ninguna de las dos aparece en los hallazgos de
`anon`/`authenticated_security_definer_function_executable`.

```sql
-- servicio_excepciones: feriados/cierres puntuales que sobreescriben
-- servicio_horarios para un día específico (decisión §1c, resuelta en 9b/10).
CREATE TABLE servicio_excepciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  servicio_id UUID NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  cerrado BOOLEAN NOT NULL DEFAULT true,
  hora_inicio TIME,
  hora_fin TIME,
  CHECK (
    (cerrado = true  AND hora_inicio IS NULL AND hora_fin IS NULL) OR
    (cerrado = false AND hora_inicio IS NOT NULL AND hora_fin IS NOT NULL AND hora_inicio < hora_fin)
  ),
  UNIQUE (servicio_id, fecha)
);

-- citas: cliente_id obligatorio (9d), mascota_id opcional (9d), duracion_minutos
-- es snapshot al crear (no se recalcula si el servicio cambia después),
-- estado con 4 valores (9e).
CREATE TABLE citas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  servicio_id UUID NOT NULL REFERENCES servicios(id) ON DELETE RESTRICT,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  mascota_id UUID REFERENCES mascotas(id) ON DELETE SET NULL,
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  duracion_minutos INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'confirmada'
    CHECK (estado IN ('confirmada', 'cancelada', 'completada', 'no_show')),
  notas TEXT CHECK (char_length(notas) <= 500),
  motivo_cancelacion TEXT CHECK (char_length(motivo_cancelacion) <= 500),
  cancelado_at TIMESTAMPTZ,
  cancelado_por TEXT,
  created_by TEXT NOT NULL,
  CHECK (hora_inicio < hora_fin)
);

-- crear_cita_tx: valida servicio/cliente/mascota, resuelve la ventana horaria
-- del día (excepción si existe, si no servicio_horarios), valida encaje y
-- ausencia de conflicto — todo serializado por pg_advisory_xact_lock (9c).
-- ERRCODE: P0002 = no encontrado; PS001 = fuera de horario habilitado;
-- PS002 = conflicto de horario (slot ocupado).
--
-- cancelar_cita_tx: mismo patrón de reclamo atómico que anular_venta_tx
-- (AGENTS.md §23.5) — el UPDATE con condición de estado es la primera y
-- única operación que transiciona a 'cancelada'.
-- ERRCODE: P0002 = no encontrada; PS003 = transición de estado inválida.
```

Ver el archivo real `migrations/066_citas.sql` para el SQL completo de ambas
funciones (omitido aquí por extensión — no hay drift entre este resumen y el
archivo aplicado, verificado en la revisión).

---

## 11. Fase 2 — Contrato de API (implementado)

Mismo patrón de auth que Fase 1 (`getStoreId()` + `requireStoreAdmin` cuando
aplica), con una diferencia: **crear/cancelar/completar una cita no requiere
rol admin** (decisión §9a — es una operación operativa de cualquier
`storeWorker`, igual que registrar una venta en el POS). Solo la
configuración de excepciones/feriados es admin-only, igual que
horarios/servicios en Fase 1.

- `POST /api/citas` — `src/app/api/citas/route.ts`. Llama `crear_cita_tx`.
  Mapeo de errores: `P0002`→`404`; `PS001`→`422` (regla de negocio: fuera de
  horario); `PS002`→`409` (conflicto). `201` con la cita creada.
- `GET /api/citas` — mismo archivo. Filtros opcionales `fecha`,
  `servicio_id`, `cliente_id`, `estado` vía `CitasQuerySchema`. Joins con
  `clientes(nombre, telefono)`, `mascotas(nombre)`, `servicios(nombre)`.
- `GET /api/citas/[id]` — `src/app/api/citas/[id]/route.ts`. Mismo `select`
  con joins, `404` si `PGRST116`.
- `PATCH /api/citas/[id]` — mismo archivo. `CitaAccionSchema` (unión
  discriminada por `accion`): `cancelar` (llama `cancelar_cita_tx`,
  `P0002`→`404`, `PS003`→`409`), `completar`/`no_show` (transición simple
  sin RPC — `SELECT` previo distingue `404` de `409`, `.eq("estado",
  "confirmada")` en el `UPDATE` como defensa contra carrera entre el
  `SELECT` y el `UPDATE`). No hay `DELETE`: cancelar es un cambio de estado,
  no un borrado.
- `GET /api/servicios/[id]/disponibilidad` — calcula ventana horaria del día
  (excepción > horario semanal), trae citas ocupadas, genera slots con
  `calcularSlotsDisponibles` (§13). `[]` si el día está cerrado o sin
  horario configurado.
- `GET/POST /api/servicios/[id]/excepciones` — GET abierto a la tienda;
  POST admin-only (`ServicioExcepcionCreateSchema`), `409` en fecha
  duplicada (`23505`).
- `DELETE /api/servicios/[id]/excepciones/[excepcionId]` — admin-only, hard
  delete (a diferencia del soft-delete de `servicios`): una excepción no
  tiene referencias entrantes, es un toggle de configuración sin historial
  que preservar.

---

## 12. Fase 2 — Tipos TypeScript (implementados)

`CitaEstado`, `Cita` (con joins opcionales `cliente`/`mascota`/`servicio`),
`ServicioExcepcion`, `SlotDisponible` — agregados a `src/types/index.ts`.

---

## 13. Fase 2 — Librería pura de disponibilidad — `src/lib/disponibilidad.ts` (implementada)

Funciones puras, sin mocks de DB: `rangosSuperponen`, `sumarMinutos`,
`calcularSlotsDisponibles`, `diaSemanaIsoDesdeFecha`. Se extraen como
funciones puras porque el cálculo de disponibilidad es de solo lectura (la
única sección crítica real es *reservar*, ya cubierta por `crear_cita_tx`
en SQL con el advisory lock).

**Limitaciones documentadas, no bugs:**
- No contempla cruce de medianoche (`sumarMinutos("23:30", 60)` produce
  `"24:30"`, una hora inválida) — los servicios del catálogo son diurnos y
  el `CHECK hora_inicio < hora_fin` de `citas`/`servicio_horarios` lo
  impide a nivel de datos.
- No hay ajuste de zona horaria para excluir slots ya pasados si `fecha` es
  hoy — `stores` no tiene columna de timezone. La UI puede filtrar
  client-side con la hora local del navegador como aproximación; no es
  parte de este endpoint.
- `diaSemanaIsoDesdeFecha` parsea la fecha como UTC (`getUTCDay()`) para
  coincidir exactamente con `EXTRACT(ISODOW ...)` del lado SQL —
  verificado con un caso concreto en los tests (`2026-08-10` es lunes,
  ISODOW=1).

---

## 14. Fase 2 — Schemas Zod — `src/lib/validation/citas.ts` (implementado)

`CitaCreateSchema`, `CitaAccionSchema` (unión discriminada por `accion`),
`CitasQuerySchema`, `DisponibilidadQuerySchema`, `ServicioExcepcionCreateSchema`
(con `.refine()` cruzado: `cerrado=true` sin horas, `cerrado=false` con
`hora_inicio < hora_fin` obligatorias).

---

## 15. Fase 2 — Desglose de tareas (completado)

Migración → tipos → librería pura → Zod → API (`citas`, `disponibilidad`,
`excepciones`) → UI (`/citas`: `CitasTab` + `NuevaCitaForm`;
`ExcepcionesEditor` agregado a `/servicios`) → tests → registro en
`docs/spec-registry.md`. `layout.tsx` recibió el link `/citas` con
`storeWorker` incluido en los roles (a diferencia de `/servicios`, que
quedó `storeAdmin`/`systemAdmin` únicamente — decisión §9a).

---

## 16. Fase 2 — Plan de pruebas (implementado — I-CITA-01 a I-CITA-45, U-CITA-01 a U-CITA-18, PROP-05)

Sub-prefijo `I-CITA-NN`/`U-CITA-NN`, mismo patrón que `I-SRV-NN` de Fase 1.
Registrado íntegro en `docs/spec-registry.md` sección "Citas — Fase 2".
Cobertura: autorización (crear/cancelar/completar sin rol admin — §9a;
excepciones admin-only), aislamiento de tenant, los 3 códigos `ERRCODE`
custom (`P0002`/`PS001`/`PS002`/`PS003`) mapeados a HTTP, cálculo de
disponibilidad (excepción vs. horario semanal, exclusión de slots
ocupados, borde de ventana), y la función pura `calcularSlotsDisponibles`
tanto con casos concretos como con una propiedad `fast-check` (`PROP-05`:
ningún slot generado excede la ventana).

---

## 17. Fase 3 — Alcance excluido explícitamente (NO implementado)

Cada ítem tiene preguntas de producto propias sin resolver, listadas para
que quede claro qué falta decidir antes de poder diseñarlo con el mismo
nivel de detalle que Fase 1/2:

- **Notificaciones/recordatorios** de citas (creación, cancelación,
  recordatorio previo) — falta decidir canal (email vía Resend, WhatsApp
  vía la integración ya existente, ambos), y con qué anticipación.
- **Multi-profesional** — asignar qué miembro del staff atiende cada cita,
  con su propio horario individual (¿hereda `servicio_horarios` o tiene uno
  propio por profesional?). No hay ni un campo `profesional_id` en Fase 2.
- **Buffer time** entre citas (tiempo de limpieza/preparación) — hoy los
  slots son contiguos sin espacio (§13). Requiere decidir si el buffer es
  global, por servicio, o configurable por profesional (si se agrega esta
  fase).
- **Integración con POS** — cobrar el servicio al completar la cita
  (¿genera una `venta` automáticamente? ¿de qué `metodo_pago`?) — y con
  **canales externos** (reserva vía Instagram/WhatsApp bot, análogo a
  `canal_ordenes`).
- **Vista de calendario/agenda visual** para el staff (hoy Fase 2 solo
  ofrece un listado filtrable, no una grilla de calendario).
- **Autoservicio del cliente** — reserva pública sin login de staff (ver
  §9a). Requiere: verificación de identidad sin Clerk (¿por teléfono?
  ¿email con código?), rate limiting, protección anti-spam, y – si se
  habilita – recién ahí tiene sentido una **política de anticipación mínima
  para cancelar** (§9f, hoy sin restricción porque solo cancela el staff).
- **Detección automática de no-show** — hoy `no_show` es una transición
  manual del staff (§9e); automatizarla (ej. marcar automáticamente tras N
  minutos sin check-in) es una decisión de producto separada.
- **Reagendar atómico** preservando el mismo `id` de cita (§9g, hoy es
  cancelar + crear nueva sin vínculo explícito entre ambas).

---

## 0. Verificación de este documento

- Contenido revisado línea por línea contra el código real del repo (no
  solo generado y aceptado): patrón RLS, firma de `requireStoreAdmin`,
  estructura de `categorias/route.ts` y `[id]/route.ts`, convención de IDs
  en `docs/spec-registry.md`, `navItems` de `layout.tsx`, y precedente
  `SECURITY DEFINER` + `GRANT EXECUTE ... TO service_role` en migraciones
  037/053/060/061 — todo confirmado exacto.
- Dos matices dejados explícitos en el propio documento (§2): la
  serialización de `TIME` es *inferida, no verificada* contra la instancia
  real (no hay precedente de columna `TIME` en el schema), y el mapeo de
  error `P0002` es una *desviación deliberada del precedente existente*,
  decidida explícitamente con el usuario — el repo real usa matching por
  mensaje en `anular_venta_tx`, pero para este RPC nuevo se adoptó
  `ERRCODE` a propósito por ser más robusto.
- **Actualización tras implementación de Fase 1:** la migración 063 fue
  implementada, revisada línea por línea contra el código real, corregida
  (`duracion_minutos` pasó de rango libre 5-480 a enum cerrado `{30,60,90}`
  — fidelidad al requisito literal del usuario, no una decisión de diseño
  nueva) y aplicada a `wnxrdbnvreofrrmhcybc`. Durante la verificación
  post-aplicación con `get_advisors` se encontró que `replace_servicio_horarios`
  (`SECURITY DEFINER`) era ejecutable directamente por `anon`/`authenticated`
  vía `/rest/v1/rpc/`, saltándose Clerk y `requireStoreAdmin` — cerrado con
  las migraciones `064`/`065` (`REVOKE EXECUTE`). El mismo patrón preexiste
  en 7 funciones RPC del proyecto (`crear_venta_tx`, `anular_venta_tx`,
  etc.) — no se tocaron, quedan como hallazgo de seguridad pendiente fuera
  de este alcance.
- **Verificación de Fase 2 (migración 066):** revisada archivo por archivo
  contra el diseño de §9-§17 y contra los patrones ya establecidos en Fase
  1 — sin desviaciones de fidelidad como la de `duracion_minutos`. El
  autor de la implementación generalizó proactivamente el hallazgo de
  seguridad de Fase 1: `crear_cita_tx` y `cancelar_cita_tx` incluyeron
  `REVOKE EXECUTE ... FROM PUBLIC` y `FROM anon, authenticated` en la misma
  migración 066, sin esperar a que `get_advisors` lo marcara después.
  Verificado tras aplicar: `pg_proc.proacl` de ambas funciones solo lista
  `postgres`/`service_role`; `get_advisors` no las incluye en los
  hallazgos de `anon`/`authenticated_security_definer_function_executable`
  (solo persisten las mismas 7 funciones preexistentes, sin cambios).
  `npm run typecheck`, `npm run lint`, `npm test` (1864/1864) y
  `npm run build` verificados en verde antes de aplicar la migración.
- Ambas migraciones (063 y 066, más 064/065 de seguridad) están aplicadas
  en el único proyecto Supabase real. Las tablas `servicios`,
  `servicio_horarios`, `servicio_excepciones` y `citas` existen y están
  vacías (sin datos existentes afectados por este cambio).

---

## 18. Estado final

**Fase 1 y Fase 2: implementadas, revisadas y aplicadas.** Alcance
construido: catálogo de servicios con duración fija `{30,60,90}` min,
horario semanal por día, excepciones/feriados puntuales, citas de clientes
con cálculo de disponibilidad y prevención de conflictos bajo concurrencia
(`pg_advisory_xact_lock`), cancelaciones con trazabilidad, y estados
`confirmada`/`cancelada`/`completada`/`no_show`. Fase 3 (§17) — notificaciones,
multi-profesional, buffer time, integración POS/canales, calendario visual,
autoservicio del cliente — queda explícitamente sin diseñar ni implementar.

**Riesgo pendiente conocido, fuera de este alcance:** el patrón de RPCs
`SECURITY DEFINER` ejecutables por `anon`/`authenticated` en 7 funciones
preexistentes del proyecto (ventas, notas de crédito, saldos a favor) no se
corrigió — es una superficie de seguridad real que amerita una revisión
dedicada, separada de este cambio.
