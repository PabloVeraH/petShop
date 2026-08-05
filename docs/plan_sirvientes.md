# Plan: Encargados de servicio (Fase 3 de "servicios agendables")

Este documento diseña la asignación de un miembro del personal ("encargado")
a cada cita, el CRUD de encargados, su visibilidad en el listado de citas, y
sus estadísticas de servicios tomados/finalizados.

Es la continuación directa de `docs/plan_servicios.md` §17, que dejó
explícitamente fuera de la Fase 2 el campo "multi-profesional" ("no hay ni
un campo `profesional_id` en Fase 2") y planteó, sin resolver, la pregunta
que este plan responde: si el profesional asignado participa o no en el
cálculo de disponibilidad/conflictos.

El nombre de archivo (`plan_sirvientes.md`) es el pedido por el usuario; el
código, schema y UI usan el término **encargado** (consistente con el resto
del dominio en español del proyecto — "servicios", "citas").

## 0. Decisiones ya resueltas con el usuario (2026-08-04)

| # | Pregunta | Decisión |
|---|----------|----------|
| 1 | Modelo de datos del encargado | Entidad nueva e independiente (tabla `encargados`), **no** reutiliza `clerk_users`/workers. CRUD simple, sin cuenta de sistema. |
| 2 | Disponibilidad | Sí: se valida que el mismo encargado no quede en dos citas con horario traslapado (chequeo nuevo, **aditivo** al que ya existe por servicio — ver §1 más abajo, es una interpretación que debe confirmarse). |
| 3 | Obligatoriedad | `encargado_id` obligatorio al crear una cita nueva, igual que `servicio_id`/`cliente_id`. |
| 4 | Permisos CRUD | `storeAdmin` y `systemAdmin` (igual que `servicios`/`categorías`); baja lógica (`activo=false`), no `DELETE` real, para no romper la referencia desde citas históricas. |

## 1. Decisión confirmada: sin paralelismo por servicio (2026-08-04)

Confirmaste que **no** quieres que 2 encargados puedan atender el mismo
servicio al mismo tiempo. Esto es exactamente el comportamiento que ya
implementa el chequeo de conflicto existente por `servicio_id` en
`crear_cita_tx` (`migrations/066_citas.sql`) — **no requiere cambios**: hoy
un `servicio_id` ya admite una sola cita por franja horaria, sin importar
qué encargado se asigne, y este plan no lo toca (ver
`src/app/api/servicios/[id]/disponibilidad/route.ts` líneas 73-80 — el
`ocupados` se arma filtrando únicamente por `servicio_id`, no por persona).

Lo que sí agrega este plan (§3c) es un chequeo **adicional e independiente**
por `encargado_id`, que cubre el caso complementario que el chequeo por
servicio NO detecta: el mismo encargado asignado a dos citas de servicios
**distintos** en horarios traslapados (ej. Juan agendado en "Baño"
10:00-10:30 y también en "Corte" 10:15-10:45 — mismo horario, distinto
servicio, mismo encargado, algo que el chequeo por `servicio_id` no ve
porque compara dentro del mismo `servicio_id`). Con ambos chequeos activos:

| Escenario | ¿Se permite? |
|-----------|-------------|
| Mismo servicio, mismo horario, cualquier encargado (mismo o distinto) | ❌ Bloqueado (chequeo por `servicio_id`, ya existente) |
| Mismo encargado, mismo horario, servicios distintos | ❌ Bloqueado (chequeo nuevo por `encargado_id`, §3c) |
| Servicios distintos, horarios distintos, mismo o distinto encargado | ✅ Permitido |

Este punto queda cerrado — ya no es una decisión pendiente.

## 2. Hallazgo verificado contra la base real (no asumido)

Consulté (solo lectura, sin escritura) la tabla `citas` en el proyecto
Supabase real (`wnxrdbnvreofrrmhcybc`): **5 filas existentes, 2 en estado
`completada`**. La tabla **no está vacía**, a diferencia de lo que indicaba
la memoria de sesión de cuando se aplicó la migración 066.

Esto descarta agregar `citas.encargado_id` como `NOT NULL` directo — rompería
esas 5 filas o forzaría un backfill (asignar retroactivamente un encargado
inventado a citas reales), que es exactamente el tipo de operación que
`AGENTS.md` §0.1/§7.2 exige NO hacer sin autorización explícita y sin dato
real que la respalde (no hay forma de saber, hoy, quién atendió esas 5 citas
pasadas).

**Diseño elegido**: `citas.encargado_id` se agrega como columna **NULLABLE**
a nivel de base de datos (las 5 citas existentes quedan con
`encargado_id = NULL`, mostradas como "Sin asignar"). La obligatoriedad
("Decisión 3" de la tabla de arriba) se aplica en la capa de aplicación —
`CitaCreateSchema` exige `encargado_id` para **citas nuevas** vía
`crear_cita_tx` — no como `NOT NULL` en el schema SQL. Esto es coherente con
cómo `mascota_id` ya es nullable hoy aunque el flujo normal siempre lo
complete cuando corresponde.

## 3. Modelo de datos

### 3a. Tabla `encargados`

Mismo patrón que `servicios` (`migrations/063_servicios.sql`): catálogo
simple por tienda, con baja lógica.

```sql
CREATE TABLE IF NOT EXISTS encargados (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  nombre      TEXT         NOT NULL CHECK (char_length(nombre) BETWEEN 2 AND 100),
  activo      BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_encargados_store_id ON encargados(store_id);

ALTER TABLE encargados ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "encargados_store_isolation" ON encargados
    FOR ALL USING (store_id = get_user_store_id() OR is_system_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_encargados_updated_at
    BEFORE UPDATE ON encargados
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

Deliberadamente **sin** más columnas (sin "especialidad", "foto", "teléfono"
— no fueron pedidas; YAGNI). Se puede extender después si hace falta.

`UNIQUE (store_id, nombre)` replica el mismo constraint de `servicios` — si
no lo quieres, dímelo antes de aplicar.

### 3b. `citas.encargado_id`

```sql
ALTER TABLE citas ADD COLUMN IF NOT EXISTS encargado_id UUID REFERENCES encargados(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_citas_encargado_id ON citas(encargado_id);
```

`ON DELETE RESTRICT` (no `SET NULL`): dado que no hay `DELETE` real de
encargados (solo baja lógica, decisión 4), esto es una defensa adicional que
no debería activarse nunca en flujo normal.

### 3c. `crear_cita_tx` — cambios

Nuevo parámetro `p_encargado_id UUID` (nullable a nivel de firma para no
romper compatibilidad si se reutiliza en otro contexto, pero la API siempre
lo enviará no-nulo para citas nuevas vía `CitaCreateSchema`).

Cambios dentro de la función (ver `migrations/066_citas.sql` para el cuerpo
actual completo):

1. Validar que el encargado existe, está activo y pertenece a `p_store_id`
   (mismo patrón que la validación de servicio/cliente, `RAISE EXCEPTION ...
   USING ERRCODE = 'P0002'` si no).
2. Segundo advisory lock, **aditivo** al que ya existe, en el mismo orden
   siempre (servicio primero, encargado después) para no introducir
   deadlocks entre transacciones concurrentes:
   ```sql
   PERFORM pg_advisory_xact_lock(hashtextextended(p_servicio_id::text || p_fecha::text, 0)); -- ya existe
   PERFORM pg_advisory_xact_lock(hashtextextended(p_encargado_id::text || p_fecha::text, 1)); -- nuevo, seed distinto
   ```
3. Chequeo de conflicto nuevo, **sin filtrar por `servicio_id`** (el
   encargado no puede estar en dos citas de *ningún* servicio a la misma
   hora):
   ```sql
   IF EXISTS (
     SELECT 1 FROM citas
      WHERE encargado_id = p_encargado_id AND store_id = p_store_id AND fecha = p_fecha
        AND estado != 'cancelada'
        AND hora_inicio < v_hora_fin AND hora_fin > p_hora_inicio
   ) THEN
     RAISE EXCEPTION 'El encargado ya tiene otra cita en ese horario' USING ERRCODE = 'PS004';
   END IF;
   ```
4. `INSERT INTO citas (..., encargado_id)` incluye el nuevo campo.

Código de error nuevo: `PS004` (los existentes son `PS001` horario fuera de
rango, `PS002` conflicto de servicio, `PS003` transición de estado inválida
en `cancelar_cita_tx`) → mapear a HTTP 409 en la ruta, mismo tratamiento que
`PS002`.

### 3d. Migración — `migrations/067_encargados.sql`

Siguiente número libre (066 es la última aplicada, verificado con
`list_migrations` contra el proyecto real). Contiene 3a + 3b +
`CREATE OR REPLACE FUNCTION crear_cita_tx(...)` con los cambios de 3c
(mismo patrón que 066: `GRANT EXECUTE ... TO service_role` +
`REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` en la misma migración,
por el mismo motivo que 064/065 — Supabase otorga EXECUTE a
anon/authenticated como grant directo en funciones nuevas).

**No aplicar sin tu confirmación explícita** — mismo protocolo que 066
(`AGENTS.md` §11.2, único proyecto real).

## 4. Contrato de API

### CRUD de encargados (nuevo)

- **`GET /api/encargados`** — `src/app/api/encargados/route.ts`. Lectura
  abierta a cualquier usuario autenticado de la tienda (igual que
  `GET /api/servicios`). Devuelve encargados activos **con conteo de
  citas** (ver §6):
  ```ts
  { id, nombre, activo, citas_totales, citas_completadas }[]
  ```
- **`POST /api/encargados`** — solo `storeAdmin`/`systemAdmin`
  (`requireStoreAdmin`, mismo patrón try/catch → 403 de `servicios/route.ts`).
  Body: `EncargadoCreateSchema`. `store_id` siempre del contexto, nunca del
  body. `logAudit` fire-and-forget en error y éxito, igual que servicios.
- **`GET /api/encargados/[id]`** — detalle, lectura abierta a la tienda.
- **`PATCH /api/encargados/[id]`** — solo admin. Body: `EncargadoUpdateSchema`
  (`nombre`, `activo` parciales). Mismo patrón de fetch-previo para 404 +
  `oldValues` de auditoría que `servicios/[id]/route.ts`.
- **`DELETE /api/encargados/[id]`** — solo admin. Soft delete
  (`activo: false`), 204, mismo patrón exacto que
  `DELETE /api/servicios/[id]`.

### Citas (extendido)

- **`POST /api/citas`** — `CitaCreateSchema` gana `encargado_id: UUIDSchema`
  (obligatorio, no `.optional()`). El body se pasa a `crear_cita_tx` como
  `p_encargado_id`. Nuevo mapeo de error: `PS004` → 409 (mismo bloque que
  `PS002` hoy).
- **`GET /api/citas`** — el `.select(...)` gana
  `encargado:encargados(nombre)`; `CitasQuerySchema` gana `encargado_id`
  opcional como filtro (mismo patrón que `servicio_id`/`cliente_id`).
- **`GET /api/citas/[id]`** — mismo `.select(...)` extendido.

### Disponibilidad (extendido)

- **`GET /api/servicios/[id]/disponibilidad?fecha=...&encargado_id=...`** —
  `encargado_id` pasa a ser **query param obligatorio** (única forma de que
  el chequeo aditivo de §1 tenga sentido en el flujo de creación: si no se
  filtra por encargado, la UI podría mostrar como "libre" un slot donde el
  encargado elegido ya está ocupado en otro servicio, y el usuario recién se
  entera al enviar el formulario con un 409).
  - Se agrega una segunda consulta de `ocupados`, esta vez sin filtrar por
    `servicio_id` (igual que el chequeo SQL de §3c):
    ```ts
    const { data: citasEncargado } = await supabase
      .from("citas")
      .select("hora_inicio, hora_fin")
      .eq("encargado_id", encargadoId)
      .eq("store_id", ctx.storeId)
      .eq("fecha", fecha)
      .neq("estado", "cancelada");
    ```
  - `ocupados` final = unión de los rangos por servicio (como hoy) + los
    rangos por encargado, antes de pasar a `calcularSlotsDisponibles`
    (`src/lib/disponibilidad.ts` no cambia — sigue siendo una función pura
    que solo recibe `ocupados: RangoHorario[]`, agnóstica de por qué un
    rango está ocupado).
  - `DisponibilidadQuerySchema` gana `encargado_id: UUIDSchema` obligatorio.

## 5. Tipos TypeScript — agregar a `src/types/index.ts`

```ts
// ─── Encargados de servicio (Fase 3) ─────────────────────────────────────
export interface Encargado {
  id: string;
  store_id: string;
  nombre: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
  citas_totales?: number;      // solo presente en GET /api/encargados (agregado)
  citas_completadas?: number;  // idem
}
```

Y extender `Cita` (línea ~141-162 hoy):

```ts
export interface Cita {
  // ...campos existentes...
  encargado_id?: string | null;
  encargado?: Pick<Encargado, "nombre">;
}
```

## 6. Zod schemas — nuevo `src/lib/validation/encargados.ts`

```ts
import { z } from "zod";

export const EncargadoCreateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
});

export const EncargadoUpdateSchema = z.object({
  nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100).optional(),
  activo: z.boolean().optional(),
});
```

Y en `src/lib/validation/citas.ts`:

```ts
export const CitaCreateSchema = z.object({
  servicio_id: UUIDSchema,
  cliente_id: UUIDSchema,
  encargado_id: UUIDSchema, // nuevo, obligatorio — sin .optional()
  mascota_id: UUIDSchema.nullable().optional(),
  fecha: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)"),
  hora_inicio: z.string().regex(HORA_REGEX, "Formato de hora inválido (use HH:MM)"),
  notas: z.string().max(500).optional(),
});

export const CitasQuerySchema = z.object({
  fecha: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)").optional(),
  servicio_id: UUIDSchema.optional(),
  cliente_id: UUIDSchema.optional(),
  encargado_id: UUIDSchema.optional(), // nuevo
  estado: z.enum(["confirmada", "cancelada", "completada", "no_show"]).optional(),
});

export const DisponibilidadQuerySchema = z.object({
  fecha: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)"),
  encargado_id: UUIDSchema, // nuevo, obligatorio
});
```

Recordatorio: `CitaCreateSchema` volviéndose obligatorio en `encargado_id`
**rompe** cualquier test existente que hoy construye el body sin ese campo
— hay que actualizarlos como parte de esta fase, no es opcional (§9).

Exportar los nuevos schemas desde el barrel `src/lib/validation.ts` (o donde
esté el re-export central — confirmar el patrón real del archivo al
implementar, no asumirlo).

## 7. UI

### 7a. CRUD de encargados — nueva ruta `/encargados`

Mirror exacto de `/servicios` (`src/app/(app)/servicios/page.tsx` +
`ServiciosTab.tsx`): sin tabs adicionales, sin horarios/excepciones (eso es
específico de servicios, no aplica a encargados).

`src/app/(app)/encargados/page.tsx`:
```tsx
"use client";
import { EncargadosTab } from "./components/EncargadosTab";

export default function EncargadosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">Encargados</h1>
        <p className="text-sm text-gray-500">Personal que atiende los servicios agendables</p>
      </div>
      <EncargadosTab />
    </div>
  );
}
```

`src/app/(app)/encargados/components/EncargadosTab.tsx` — mismo esqueleto
que `ServiciosTab.tsx`: gate `isAdmin` vía `useUser()`, form crear/editar
(solo campo `nombre`), lista con botón "Editar"/"Desactivar", modal de
confirmación de baja. Diferencia con servicios: cada fila de la lista
muestra las estadísticas pedidas por el usuario:

```
Juan Pérez                                    [Editar] [Desactivar]
12 citas tomadas · 8 finalizadas
```

usando `citas_totales`/`citas_completadas` que ya vienen en la respuesta de
`GET /api/encargados` (§4) — sin queries adicionales en el cliente, mismo
enfoque que `/api/workers` agregando `ventas_mes`/`ventas_hoy` server-side.

Falta agregar el link de navegación a `/encargados` en el layout/sidebar de
la app — confirmar el archivo real de navegación al implementar (no
inspeccionado en este plan).

### 7b. `NuevaCitaForm.tsx` — selector de encargado

Cambios sobre el archivo actual (`src/app/(app)/citas/components/NuevaCitaForm.tsx`):

- Nuevo `useQuery` para `GET /api/encargados` (mismo patrón que la query de
  `servicios` ya existente en el archivo).
- Nuevo `<select>` de encargado, mismo estilo que el `<select>` de servicio.
- **Reordenar el flujo**: hoy los slots se piden apenas hay
  `servicioId + fecha`. Con `encargado_id` obligatorio en el endpoint de
  disponibilidad (§4), los slots deben pedirse solo cuando también hay
  `encargadoId` seleccionado:
  ```ts
  enabled: !!servicioId && !!encargadoId && !!fecha,
  ```
  y la query key/URL de disponibilidad debe incluir `encargado_id`.
- `puedeConfirmar` gana `&& encargadoId` a la condición existente.
- El body de `POST /api/citas` incluye `encargado_id: encargadoId`.

### 7c. `CitasTab.tsx` — mostrar encargado en el listado

Pedido explícito del usuario ("en el listado ... se vea el nombre del que
ejecuta el servicio"). Cambio mínimo en el bloque de cada fila
(línea ~128-135 hoy):

```tsx
<p className="text-xs text-gray-400">
  {c.servicio?.nombre ?? "—"} · {c.duracion_minutos} min
  {c.encargado?.nombre ? ` · ${c.encargado.nombre}` : " · Sin asignar"}
  {c.cliente?.telefono ? ` · ${c.cliente.telefono}` : ""}
</p>
```

"Sin asignar" cubre las 5 citas existentes con `encargado_id = NULL` (§2).

Filtro opcional por encargado (mismo `<select>` que ya existe para
servicio/estado) — no fue pedido explícitamente, pero es trivial dado el
patrón ya presente en el mismo archivo. Lo incluyo en la tarea de UI de
`CitasTab` como ítem de bajo esfuerzo, no como requisito separado; sácalo si
no lo quieres.

## 8. Permisos y auditoría — resumen

| Acción | Quién | Auditoría |
|--------|-------|-----------|
| Crear/editar/desactivar encargado | `storeAdmin` / `systemAdmin` | `logAudit` (mismo patrón que servicios) |
| Asignar encargado al crear una cita | Cualquier staff autenticado de la tienda (decisión §9a de `plan_servicios.md`, heredada — crear una cita no requiere admin) | Ya cubierto por el `logAudit` existente de `crear_cita_tx` en la ruta |
| Ver estadísticas de un encargado | Cualquier staff autenticado de la tienda (lectura abierta, igual que servicios) | N/A |

## 9. Desglose de tareas — orden de implementación

1. Migración `067_encargados.sql` (tabla + columna + RPC) — **requiere tu
   autorización explícita para aplicar**, igual que 066.
2. Tipos TypeScript (`Encargado`, extender `Cita`).
3. Zod schemas (`encargados.ts` nuevo; extender `citas.ts`).
4. API: `/api/encargados` + `/api/encargados/[id]`.
5. API: extender `/api/citas` (POST/GET), `/api/citas/[id]` (GET),
   `/api/servicios/[id]/disponibilidad` (param `encargado_id`).
6. **Actualizar tests existentes de citas** que construyen `CitaCreateSchema`
   / llaman `POST /api/citas` sin `encargado_id` — se rompen con este
   cambio, no es opcional (grep `encargado_id` pendiente en
   `tests/integration/api/citas.test.ts` y `tests/unit/lib/validation.test.ts`
   antes de dar la tarea por completa, gate §2.2 de `AGENTS.md`).
7. UI: `/encargados` (`EncargadosTab.tsx` + página + link de navegación).
8. UI: `NuevaCitaForm.tsx` (selector + reordenar flujo de disponibilidad).
9. UI: `CitasTab.tsx` (columna encargado + filtro opcional).
10. Tests nuevos (§10).
11. `graphify update .`.

## 10. Plan de pruebas — IDs propuestos

Rango tentativo — **re-grepear `docs/spec-registry.md` y `tests/` antes de
asignar definitivamente** (`AGENTS.md` §2.3, el registry puede estar
desincronizado del código al momento de implementar).

### Integración — `tests/integration/api/encargados.test.ts` (nuevo)

| ID | Caso |
|----|------|
| I-ENC-01 | POST crea encargado (storeAdmin) |
| I-ENC-02 | POST rechaza sin auth (401) |
| I-ENC-03 | POST rechaza rol insuficiente (403, storeWorker) |
| I-ENC-04 | POST rechaza nombre duplicado en la misma tienda (409) |
| I-ENC-05 | GET lista solo encargados activos de la tienda propia (aislamiento tenant) |
| I-ENC-06 | GET incluye `citas_totales`/`citas_completadas` correctos |
| I-ENC-07 | PATCH actualiza nombre/activo (storeAdmin) |
| I-ENC-08 | PATCH 404 sobre encargado de otra tienda (IDOR) |
| I-ENC-09 | DELETE hace soft delete (`activo=false`), no borra la fila |
| I-ENC-10 | DELETE 404 sobre id inexistente |

### Integración — extender `tests/integration/api/citas.test.ts`

| ID | Caso |
|----|------|
| I-CITA-46 | POST sin `encargado_id` → 400 (ahora obligatorio) |
| I-CITA-47 | POST con `encargado_id` de otra tienda → 404 (P0002) |
| I-CITA-48 | POST con `encargado_id` inactivo → 404 (P0002) |
| I-CITA-49 | POST con dos citas del mismo encargado en horarios traslapados → la segunda 409 (PS004) |
| I-CITA-50 | POST con mismo encargado, mismo horario, **distinto** servicio → también 409 (PS004, el chequeo no filtra por servicio) |
| I-CITA-51 | POST con dos encargados distintos, mismo servicio, mismo horario → 409 por el límite existente de `servicio_id` (comportamiento **confirmado como deseado**, §1 — no es una limitación, es el diseño) |
| I-CITA-52 | GET lista incluye `encargado.nombre` vía join |
| I-CITA-53 | GET filtra por `encargado_id` |
| I-CITA-54 | Disponibilidad excluye slots donde el encargado ya tiene otra cita (de cualquier servicio) ese día |
| I-CITA-55 | Disponibilidad sin `encargado_id` en query → 400 (ahora obligatorio) |

### Unit — agregar a `tests/unit/lib/validation.test.ts`

| ID | Caso |
|----|------|
| U-ENC-01 | `EncargadoCreateSchema`: nombre < 2 chars → fail |
| U-ENC-02 | `EncargadoCreateSchema`: nombre válido → pass |
| U-ENC-03 | `EncargadoUpdateSchema`: todos los campos opcionales → `{}` pasa |
| U-ENC-04 | `CitaCreateSchema`: sin `encargado_id` → fail (regresión del cambio a obligatorio) |

## 11. Fuera de alcance (heredado de `plan_servicios.md` §17 + nuevo)

Todo lo ya excluido en Fase 2 sigue excluido: notificaciones/recordatorios,
buffer time, integración POS/cobro al completar, canales externos, vista de
calendario visual, autoservicio de cliente, detección automática de
no-show, reagendar atómico.

Específicamente nuevo de esta fase:

- **Horario individual por encargado** (que un encargado solo pueda
  agendarse dentro de su propio turno) — hoy la única ventana horaria sigue
  siendo la de `servicio_horarios`/`servicio_excepciones`; el encargado no
  tiene horario propio.
- **Paralelismo real por servicio** (2+ encargados atendiendo el mismo
  servicio a la misma hora) — confirmado explícitamente que NO se quiere
  (§1); el límite de una cita por `servicio_id` y franja horaria se
  mantiene sin cambios.
- **Reasignar el encargado de una cita ya creada** — no hay endpoint para
  eso; hoy solo se fija al crear. Si lo necesitas, es una extensión menor de
  `PATCH /api/citas/[id]` (nueva acción `reasignar_encargado`), no incluida
  aquí por no haber sido pedida.
- **Backfill de las 5 citas históricas** sin encargado — quedan
  `encargado_id = NULL` permanentemente salvo que pidas explícitamente
  asignarlas manualmente a alguien.

## 12. Verificación de este documento

- Leídos íntegramente y usados como plantilla real (no asumidos):
  `migrations/066_citas.sql`, `migrations/063_servicios.sql`,
  `src/app/api/servicios/route.ts` y `[id]/route.ts`,
  `src/app/api/servicios/[id]/disponibilidad/route.ts`,
  `src/app/(app)/servicios/components/ServiciosTab.tsx`,
  `src/app/api/citas/route.ts` y `[id]/route.ts`,
  `src/app/(app)/citas/components/CitasTab.tsx` y `NuevaCitaForm.tsx`,
  `src/lib/disponibilidad.ts`, `src/lib/validation/citas.ts`,
  `src/lib/validation/servicios.ts`, `src/lib/admin-check.ts`,
  `src/types/index.ts` (sección Servicios/Citas), `src/app/api/workers/route.ts`
  (patrón de estadísticas agregadas por persona).
- Verificado contra la base real (solo lectura): próxima migración libre es
  067; `citas` tiene 5 filas reales (2 completadas) — no está vacía, lo que
  descartó `NOT NULL` directo en `encargado_id` (§2).
- Confirmado que **no existe** hoy ningún concepto de "encargado" o
  "profesional" en el código (`grep -ri "encargado|peluquero|groomer"` sin
  resultados antes de este plan) — es una entidad nueva, no un rename de
  algo existente.
- Confirmado que `workers`/`vendedores` (`clerk_users` con
  `store_worker`/`store_admin`) es un concepto **distinto** y no reutilizado
  aquí, por decisión explícita del usuario (§0, pregunta 1).
- Pendiente de verificar al implementar: el archivo real de navegación/
  sidebar donde agregar el link a `/encargados` (no inspeccionado); el
  nombre exacto del barrel de exports de `src/lib/validation/` (asumido por
  el import `from "@/lib/validation"` visto en las rutas, no confirmado
  línea por línea).
- Verificado contra la base real (solo lectura, para el script de §13): 45
  tablas reales en el schema `public` (`list_tables`); una sola tienda
  existente, `"PetShop La Huella"` (`SELECT id, name FROM stores`).

## 13. Script de reseteo de datos de demo (`scripts/reset-demo-data.sql`)

Pedido original: agregar al plan un script de borrado de datos, ya que el
proyecto es un demo y se quiere "partir bien desde el principio". Aclaraste
después que no es un requisito estricto de esta fase — evalúo su necesidad
antes de incluirlo.

**Evaluación**: no es necesario para que la Fase 3 (encargados) funcione
técnicamente — el diseño de §2 ya maneja las 5 citas históricas con
`encargado_id = NULL` mostrando "Sin asignar", sin requerir un reset. Sí
aporta valor práctico para **probar y demostrar** esta fase: hoy la base
real tiene datos heterogéneos acumulados de sesiones de prueba anteriores
(65 ventas, 24 notas de crédito, 5 citas, etc. — verificado por consulta
real, no listado de memoria). Empezar la Fase 3 con una tienda en blanco
deja un demo limpio donde las citas nuevas ya traen `encargado_id` desde el
principio, sin casos mixtos NULL/asignado que compliquen una demostración.
Por eso sí lo incluyo, como utilidad aparte — **no** como prerrequisito
bloqueante de la implementación; las tareas de §9 no dependen de él.

**Alcance decidido contigo**: "tienda en blanco" — se conservan `stores`
(config de la tienda) y `clerk_users` (cuentas/roles de acceso, para no
tener que rehacer el login de Clerk); se vacía todo lo demás: catálogo
(`productos`, `categorias`, `servicios`, `proveedores`, y `encargados` una
vez exista) e historial completo (`clientes`, `mascotas`, `ventas`, `citas`,
contabilidad, canales externos, logs, sesiones — 43 tablas sobre las 45
reales verificadas con `list_tables`).

**Entrega**: `scripts/reset-demo-data.sql`, reutilizable — pensado para
correrse manualmente cada vez que se quiera dejar el demo en blanco (por
ejemplo antes de una presentación), no solo una vez ahora. Ya creado en el
repo como parte de este plan.

Detalles de diseño:

- Un único bloque `DO $$ ... $$` que arma la lista de tablas a vaciar
  dinámicamente con `to_regclass('public.' || t) IS NOT NULL`, así no falla
  si `encargados` todavía no existe (antes de aplicar
  `migrations/067_encargados.sql`) — simplemente la omite esa corrida.
- `TRUNCATE ... RESTART IDENTITY CASCADE` en una sola sentencia sobre las 43
  tablas candidatas — evita calcular el orden de FKs a mano; `CASCADE` solo
  alcanza a tablas que referencian a las truncadas, y ninguna de las 43
  tiene una FK que apunte "hacia atrás" a `stores`/`clerk_users`, así que
  esas dos quedan intactas.
- **No filtra por `store_id`** — vacía todas las tiendas. Hoy es equivalente
  a un reset por tienda porque solo existe una (`PetShop La Huella`). Si en
  el futuro hay más de una tienda, este script deja de servir para un reset
  selectivo — requeriría reescribirse con `DELETE ... WHERE store_id = $1`.
- **No se ejecuta solo.** Es un script SQL versionado, no un paso de build
  ni un hook — correrlo (vía `mcp__supabase__execute_sql`, el SQL editor de
  Supabase, o `psql -f`) requiere tu confirmación explícita en el momento,
  igual que aplicar una migración (`AGENTS.md` §11.2), aunque el proyecto
  sea un demo — la razón no es la política de `AGENTS.md` sino que es una
  operación irreversible sobre la única base de datos existente.

### 13a. Variante acotada — `scripts/reset-servicios-citas.sql`

Pedido de seguimiento: como encargados/citas/servicios es una funcionalidad
nueva, se agregó una segunda variante de alcance **reducido**, para probar
esta implementación en aislamiento sin vaciar el resto de la demo (ventas,
clientes, contabilidad, inventario quedan intactos).

**Tablas que vacía**: `servicios`, `servicio_horarios`,
`servicio_excepciones`, `citas`, `encargados` (esta última, solo si la
migración 067 ya está aplicada — se omite sin fallar si no existe, mismo
mecanismo `to_regclass()` que §13).

**Verificado contra `information_schema` (solo lectura)**: las únicas FKs
que referencian a `servicios` son las de `citas`, `servicio_horarios` y
`servicio_excepciones` — las 3 están incluidas en el script, así que no
queda ninguna fila huérfana fuera de este conjunto; y ninguna tabla tiene
FK hacia `citas` (no hay dependientes que se estén dejando fuera).

Mismo protocolo que §13: script versionado en `/scripts`, reutilizable, no
se ejecuta solo — requiere confirmación explícita en el momento de correrlo.

## 14. Estado final

**Plan completo, no implementado.** Ningún archivo de código fue creado ni
modificado salvo `scripts/reset-demo-data.sql` y `scripts/reset-servicios-citas.sql`
(§13/§13a, utilidades aparte que no tocan el módulo de encargados en sí).
Requiere tu revisión de §0 (decisiones ya
tomadas, para confirmar que quedaron bien reflejadas), §1 (paralelismo por
servicio — el punto más importante a confirmar) y §2 (las 5 citas
existentes) antes de empezar a implementar. El script de §13 queda
disponible pero **no se ha ejecutado** — vaciar la base real requiere tu
confirmación explícita aparte, en el momento en que decidas correrlo.
