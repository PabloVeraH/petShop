# Cambios en la Estructura de BD — Impacto en Ventas

**Documento:** Análisis de cambios en la tabla `ventas` con la nueva arquitectura multi-canal  
**Fecha:** 2026-04-19  
**Fase:** Phase 0 (Refactor Base)

---

## 📋 Resumen Ejecutivo

Con la implementación de la arquitectura multi-canal en Phase 0, la tabla `ventas` fue modificada para:

1. **Agregar soporte de canales** — Nueva columna `canal` con DEFAULT 'pos'
2. **Cambiar estrategia de precios** — Precios ahora vienen de `canal_producto_config` (no de `productos`)
3. **Agregar nuevo método de pago** — 'plataforma' para pagos desde canales externos
4. **Mantener compatibilidad hacia atrás** — Datos existentes no se pierden, se asignan automáticamente a canal 'pos'

---

## 🔄 Cambios de Estructura — Tabla `ventas`

### Antes (Pre-Phase 0)

```sql
CREATE TABLE ventas (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL,
  cliente_id UUID,
  vendedor_id UUID,
  subtotal DECIMAL,
  descuento DECIMAL DEFAULT 0,
  impuesto DECIMAL,
  total DECIMAL NOT NULL,
  metodo_pago TEXT NOT NULL CHECK (metodo_pago IN ('efectivo', 'debito', 'credito', 'transferencia', 'vale', 'multiple')),
  estado TEXT DEFAULT 'pendiente',
  numero_comprobante TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY(store_id) REFERENCES stores(id),
  FOREIGN KEY(cliente_id) REFERENCES clientes(id),
  FOREIGN KEY(vendedor_id) REFERENCES vendedores(id)
);
```

### Después (Post-Phase 0 — Migration 013)

```sql
-- Se agregó UNA sola línea:
ALTER TABLE ventas
  ADD COLUMN canal TEXT NOT NULL DEFAULT 'pos' 
  REFERENCES canales_externos(id);
```

**Nueva estructura:**
```sql
CREATE TABLE ventas (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL,
  cliente_id UUID,
  vendedor_id UUID,
  subtotal DECIMAL,
  descuento DECIMAL DEFAULT 0,
  impuesto DECIMAL,
  total DECIMAL NOT NULL,
  metodo_pago TEXT NOT NULL CHECK (metodo_pago IN ('efectivo', 'debito', 'credito', 'transferencia', 'vale', 'multiple', 'plataforma')),
  estado TEXT DEFAULT 'pendiente',
  numero_comprobante TEXT,
  canal TEXT NOT NULL DEFAULT 'pos',  -- ← NUEVA COLUMNA
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY(store_id) REFERENCES stores(id),
  FOREIGN KEY(cliente_id) REFERENCES clientes(id),
  FOREIGN KEY(vendedor_id) REFERENCES vendedores(id),
  FOREIGN KEY(canal) REFERENCES canales_externos(id)  -- ← NUEVA FK
);
```

---

## 💾 Impacto en Datos Existentes

### ✅ Compatibilidad Hacia Atrás

Todas las **ventas existentes** automáticamente reciben:
```
canal = 'pos'
```

Esto significa:
- ✅ Cero pérdida de datos
- ✅ Todas las ventas presenciales se clasifican como 'pos'
- ✅ Los reportes y contabilidad siguen funcionando sin cambios
- ✅ Las búsquedas/filtros previos siguen válidos

### 📊 Ejemplo de Migración

**Venta existente ANTES:**
```json
{
  "id": "venta-001",
  "cliente_id": "cliente-123",
  "total": 50000,
  "metodo_pago": "efectivo",
  "estado": "pagada"
}
```

**Venta existente DESPUÉS (automáticos):**
```json
{
  "id": "venta-001",
  "cliente_id": "cliente-123",
  "total": 50000,
  "metodo_pago": "efectivo",
  "estado": "pagada",
  "canal": "pos"  ← ← ← AGREGADO AUTOMÁTICAMENTE
}
```

---

## 🔐 Cambios en Validación

### Schema Zod — Antes

```typescript
export const VentaCreateSchema = z.object({
  items: z.array(z.object({
    producto_id: z.string(),
    cantidad: z.number().positive(),
    mascota_id: z.string().optional(),
  })),
  clienteId: z.string().optional(),
  metodoPago: z.enum(["efectivo", "debito", "credito", "transferencia", "vale", "multiple"]),
  descuento: z.number().optional(),
});
```

### Schema Zod — Después

```typescript
export const VentaCreateSchema = z.object({
  items: z.array(z.object({
    producto_id: z.string(),
    cantidad: z.number().positive(),
    mascota_id: z.string().optional(),
  })),
  clienteId: z.string().optional(),
  metodoPago: z.enum(["efectivo", "debito", "credito", "transferencia", "vale", "multiple", "plataforma"]),
  canal: z.enum(["pos", "rappi", "pedidosya", "ubereats"]).default("pos"),  // ← NUEVA VALIDACIÓN
  descuento: z.number().optional(),
});
```

---

## 💰 Cambio en Estrategia de Precios

### Antes: Precios en tabla `productos`

```sql
-- Lectura de precio en API
SELECT precio FROM productos WHERE id = ?
-- Problema: precio único, no diferenciado por canal
```

### Después: Precios en `canal_producto_config`

```typescript
// En /api/ventas POST
const { data: preciosCanal } = await supabase
  .from("canal_producto_config")
  .select("producto_id, precio")
  .eq("store_id", store_id)
  .eq("canal_id", canal)  // ← Lee por canal
  .in("producto_id", productoIds);
```

**Beneficios:**
- ✅ Precios diferentes por canal (ej: Rappi puede tener comisión incluida)
- ✅ Control granular de disponibilidad por canal
- ✅ Historial de cambios de precio por canal
- ✅ Promociones específicas por plataforma

**Ejemplo:**
```
Producto: "Café Latte"
  - Precio POS: $5.000
  - Precio Rappi: $6.500 (incluye comisión 30%)
  - Precio PedidosYa: $6.200 (incluye comisión 20%)
  - Precio UberEats: $6.800 (incluye comisión 35%)
```

---

## 📝 Cambios en Métodos de Pago

### Nuevo método: 'plataforma'

Se agregó para soportar pagos desde plataformas externas:

```sql
ALTER TABLE ventas
  ALTER COLUMN metodo_pago TYPE TEXT,
  ADD CONSTRAINT check_metodo_pago_new CHECK (
    metodo_pago IN ('efectivo', 'debito', 'credito', 'transferencia', 'vale', 'multiple', 'plataforma')
  );
```

**Usada para:**
- ✅ Rappi: Cliente paga a Rappi, Rappi paga a tienda
- ✅ PedidosYa: Cliente paga a PedidosYa, PedidosYa paga a tienda
- ✅ UberEats: Cliente paga a UberEats, UberEats paga a tienda

---

## 📊 Cambios en Contabilidad

### Nueva columna en `journal_entries`

```sql
ALTER TABLE journal_entries
  ADD COLUMN canal TEXT NOT NULL DEFAULT 'pos';
```

### Impacto en asientos contables

**Antes:**
```
Débito:  Caja (110101) — $5.000
Crédito: Ventas (401101) — $5.000
```

**Después (con canal):**
```
Débito:  CxC Rappi (110401) — $5.000
Crédito: Ventas (401101) — $5.000
Canal:   rappi
```

Cada canal tiene sus propias cuentas contables:
```
pos       → 110101 (Caja)
rappi     → 110401 (CxC Rappi)
pedidosya → 110402 (CxC PedidosYa)
ubereats  → 110403 (CxC UberEats)
```

---

## 🔗 Tablas Relacionadas Afectadas

| Tabla | Cambio | Impacto |
|-------|--------|--------|
| `ventas` | +`canal` column | Todas las ventas ahora asociadas a un canal |
| `canal_producto_config` | NUEVA | Precios por canal (reemplaza `productos.precio`) |
| `journal_entries` | +`canal` column | Contabilidad diferenciada por canal |
| `stock_reservas` | NUEVA | Reserva temporal de stock para órdenes en canales |
| `canal_ordenes` | NUEVA | Tracking de órdenes desde plataformas externas |
| `canal_liquidaciones` | NUEVA | Liquidaciones/pagos desde plataformas |

---

## 📡 API Changes — POST /api/ventas

### Antes

```bash
curl -X POST /api/ventas \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{"producto_id": "prod-1", "cantidad": 2}],
    "clienteId": "client-1",
    "metodoPago": "efectivo",
    "descuento": 5
  }'
```

### Después (compatible)

```bash
curl -X POST /api/ventas \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{"producto_id": "prod-1", "cantidad": 2}],
    "clienteId": "client-1",
    "metodoPago": "efectivo",
    "descuento": 5,
    "canal": "pos"  # ← NUEVO (pero opcional, default='pos')
  }'
```

### O desde Rappi (ejemplo)

```bash
curl -X POST /api/ventas \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{"producto_id": "prod-1", "cantidad": 2}],
    "clienteId": null,
    "metodoPago": "plataforma",
    "canal": "rappi",  # ← DIFERENTE CANAL
    "descuento": 0
  }'
```

---

## ⚠️ Consideraciones Importantes

### 1. Integración de Órdenes Externas

Las órdenes de Rappi/PedidosYa/UberEats:
- ✅ Se convierten a `ventas` automáticamente (con `canal` especificado)
- ✅ Usan precios de `canal_producto_config` (no `productos`)
- ✅ Generan asientos contables con cuenta específica del canal
- ✅ Se agrupan en liquidaciones por plataforma

### 2. Precios Diferenciados

Es **MUY IMPORTANTE** mantener actualizado `canal_producto_config`:

```sql
-- Mala práctica (mantenimiento manual tedioso):
UPDATE canal_producto_config 
SET precio = 6500 
WHERE canal_id = 'rappi' AND producto_id = 'cafe-latte';

-- Buena práctica (via API o UI):
POST /api/canales/config  -- Sincronizar catálogo
```

### 3. Reportes Existentes

**Mejora automática:** Los reportes ahora pueden filtrar por canal:

```
GET /api/reports?canal=rappi  -- Solo ventas Rappi
GET /api/reports?canal=pos    -- Solo ventas presenciales
GET /api/reports              -- Todas las ventas (como antes)
```

### 4. Búsquedas Históricas

Todas las ventas anteriores a Phase 0 aparecen con `canal = 'pos'`.

Para identificar ventas reales de Rappi/PedidosYa/UberEats:
```sql
-- Ventas desde canales externos (post-Phase 1)
SELECT * FROM ventas 
WHERE canal != 'pos' 
AND created_at > '2026-04-19';  -- Fecha de Phase 1

-- Ventas presenciales (todas las épocas)
SELECT * FROM ventas 
WHERE canal = 'pos';
```

---

## 🎯 Checklist de Impacto

- ✅ **Datos existentes:** Ninguna pérdida, asignados a `canal='pos'`
- ✅ **API retrocompatible:** POST /api/ventas acepta sin `canal`, default='pos'
- ✅ **Precios:** Migrados a `canal_producto_config`, con fallback a `productos` (si existe)
- ✅ **Contabilidad:** Nueva estructura soporta múltiples cuentas por canal
- ✅ **Métodos pago:** Nuevo método 'plataforma' para pagos desde apps
- ✅ **Reportes:** Funciona igual, pero ahora filtrable por canal
- ✅ **Tests:** Actualizados para incluir parámetro `canal`

---

## 📌 Conclusión

**La migración fue NON-DESTRUCTIVE (no destructiva):**

- ✅ Todas las ventas existentes se preservan
- ✅ Se asignan automáticamente a `canal='pos'` (presencial)
- ✅ APIs son hacia atrás compatibles
- ✅ Reportes existentes siguen funcionando
- ✅ Sistema de precios mejorado sin breaking changes

**Pero habilita nuevas capacidades:**

- 🆕 3 nuevos canales (Rappi, PedidosYa, UberEats)
- 🆕 Precios diferenciados por canal
- 🆕 Contabilidad multi-canal
- 🆕 Liquidaciones automáticas desde plataformas
- 🆕 Reserva inteligente de stock

---

**Última actualización:** 2026-04-19 - Documento de análisis de cambios
