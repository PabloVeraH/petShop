---
name: "nueva-migracion"
description: "Scaffoldea una nueva migración SQL para el proyecto petShop. Determina el número siguiente en la secuencia (ej: 034), crea el archivo en migrations/ con la convención de nombre correcta, genera el SQL seguro con IF NOT EXISTS / IF EXISTS según corresponda, y ejecuta la migración en Supabase. Úsalo cuando necesites agregar columnas, crear tablas, agregar índices, o modificar el esquema de la base de datos."
---

# nueva-migracion

## Qué hace

Crea migraciones SQL para petShop siguiendo la convención del proyecto:
- Número secuencial de 3 dígitos (`034_`, `035_`, …)
- SQL idempotente con `IF NOT EXISTS` / `IF EXISTS`
- Comentario de cabecera con nombre, descripción y fecha
- Aplica en Supabase vía MCP o CLI

## Uso rápido

```
/nueva-migracion agregar columna activo a clientes
/nueva-migracion crear tabla descuentos
/nueva-migracion agregar índice en ventas.created_at
```

---

## Procedimiento

1. **Listar migraciones existentes** para obtener el número siguiente:
   ```bash
   ls migrations/ | sort | tail -3
   ```

2. **Crear el archivo** con el nombre correcto:
   ```
   migrations/0XX_nombre_descriptivo.sql
   ```

3. **Generar SQL idempotente** (ver patrones abajo)

4. **Aplicar en Supabase** vía MCP `mcp__supabase__apply_migration` o:
   ```bash
   supabase db push
   ```

---

## Patrones SQL

### Agregar columna

```sql
-- 034_nombre_columna_tabla.sql
-- Descripción de por qué se agrega esta columna.

ALTER TABLE nombre_tabla
  ADD COLUMN IF NOT EXISTS nombre_columna TIPO_DATO;
```

### Crear tabla nueva

```sql
-- 034_crear_tabla_nombre.sql
-- Descripción de la tabla y su propósito.

CREATE TABLE IF NOT EXISTS nombre_tabla (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  -- columnas de negocio aquí
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS obligatorio en tablas con store_id
ALTER TABLE nombre_tabla ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "store_isolation" ON nombre_tabla
  USING (store_id = current_setting('app.store_id')::UUID);

-- Índice en store_id para performance
CREATE INDEX IF NOT EXISTS idx_nombre_tabla_store_id ON nombre_tabla(store_id);
```

### Agregar índice

```sql
-- 034_indice_tabla_columna.sql
-- Mejora performance de consultas por <columna>.

CREATE INDEX IF NOT EXISTS idx_tabla_columna ON tabla(columna);
```

### Modificar columna (renombrar, tipo)

```sql
-- 034_modificar_tabla_columna.sql
-- Descripción del cambio y razón.

-- Renombrar columna
ALTER TABLE tabla RENAME COLUMN viejo_nombre TO nuevo_nombre;

-- Cambiar tipo (cuidado: puede requerir USING)
ALTER TABLE tabla ALTER COLUMN columna TYPE NUEVO_TIPO USING columna::NUEVO_TIPO;
```

### Eliminar columna

```sql
-- 034_eliminar_columna_tabla.sql
-- Descripción de por qué se elimina.

ALTER TABLE tabla DROP COLUMN IF EXISTS columna;
```

### Agregar constraint

```sql
-- 034_constraint_tabla.sql
-- Descripción del constraint.

ALTER TABLE tabla
  ADD CONSTRAINT IF NOT EXISTS nombre_constraint
  CHECK (condicion);
```

---

## Cabecera obligatoria

Todo archivo de migración debe comenzar con:

```sql
-- 0XX_descripcion_breve.sql
-- Descripción de una línea de qué hace esta migración y por qué.
```

---

## Reglas del proyecto

- **Siempre idempotente**: usar `IF NOT EXISTS` / `IF EXISTS` para que re-ejecutar no falle
- **Multi-tenancy**: toda tabla nueva con datos de negocio DEBE tener `store_id` + RLS
- **IDs en UUID**: usar `gen_random_uuid()` como default, no SERIAL
- **Timestamps**: `created_at` y `updated_at` como `TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- **Nombre de archivo**: snake_case, descriptivo, sin espacios
- **Un objetivo por migración**: no mezclar CREATE TABLE con ALTER TABLE de otra tabla
- **No hacer rollback automático**: si la migración es destructiva, consultar primero

## Tablas principales (referencia rápida)

```
stores          — tiendas (store_id es FK en casi todo)
clerk_users     — usuarios (store_id, clerk_user_id, role, is_disabled)
productos       — catálogo (store_id, codigo_barra, categoria_id, imagen_url)
categorias      — categorías (store_id, nombre, es_alimento)
ventas          — ventas POS (store_id, cliente_id, canal)
clientes        — clientes (store_id, nombre, rut)
pagos           — pagos de venta (venta_id, metodo, monto)
notas_credito   — devoluciones (store_id, venta_id)
ordenes_compra  — órdenes a proveedores (store_id)
cuentas_pagar   — deudas (store_id, proveedor_id)
audit_logs      — auditoría (store_id, user_id, action, tabla)
journal_entries — asientos contables (store_id)
canal_ordenes   — órdenes externas (store_id, canal)
```

## Aplicar la migración

Después de crear el archivo, aplicar con MCP:

```
mcp__supabase__apply_migration con el SQL del archivo
```

O con CLI local:
```bash
supabase db push --local   # entorno local
supabase db push           # producción (confirmar primero)
```
