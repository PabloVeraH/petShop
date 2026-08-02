# Plan: Servicios agendables (Peluquería y similares)

Estado: **análisis / no implementado**. Documento de planificación, no un
cierre de cambio (§22 de `AGENTS.md`). Nada de este documento autoriza
aplicar la migración ni escribir código de producto — ver §0 "Verificación
de este documento" al final.

## Fase 1 — Configuración administrativa (este plan, listo para implementar)

Admin de tienda configura servicios ofrecidos (ej. "Peluquería — Corte
básico", 30 min) y su horario semanal habilitado (días Lun–Dom, hora
inicio/fin por día). Es solo catálogo/configuración — sin lógica de citas.

## Fase 2 — Citas de clientes (fuera de alcance, solo esbozo — ver §8)

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

## 8. Alcance excluido explícitamente — Fase 2 (NO implementar en este cambio)

- Tabla(s) de citas (`citas`: `cliente_id`, `mascota_id?`, `servicio_id`, `fecha`, `hora_inicio`/`hora_fin` calculadas desde `duracion_minutos`, `estado`).
- Cálculo de disponibilidad real (slots libres) cruzando `servicio_horarios` con citas ya reservadas.
- Detección/prevención de conflictos entre citas concurrentes (constraint de exclusión de rangos o lógica transaccional equivalente).
- Excepciones/feriados — decisión §1c, explícitamente diferida.
- Cancelaciones de citas, con o sin reglas de anticipación mínima.
- Notificaciones/recordatorios (email/WhatsApp).
- Vista de calendario/agenda para staff.
- Integración con POS (cobro del servicio) o canales externos (reserva vía Instagram/WhatsApp bot).
- Multi-profesional / asignación de quién atiende — ni siquiera un campo `profesional_id` en Fase 1 (consistente con "tienda como bloque único", decidido con el usuario).
- Buffer time / bloqueo de limpieza entre citas.

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
- Nada de este documento fue aplicado: no se creó la migración 063 en el
  filesystem, no se tocó `src/types/index.ts`, `src/lib/validation.ts` ni
  ninguna ruta API. Es únicamente el plan.
