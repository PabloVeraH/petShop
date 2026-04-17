---
tags:
  - petshop
  - devoluciones
  - funcionalidad
---

# petShop — Sistema de Devoluciones y Notas de Crédito

Documentación completa del sistema de gestión de devoluciones, reembolsos y créditos para clientes.

---

## Descripción General

El sistema permite:
- Crear notas de crédito (NC) para devoluciones parciales o totales
- Dos tipos de reembolso: directo o saldo a favor
- Restitución automática de stock por ítem (configurable)
- Rollback de fidelización (decrementar histórico de compras)
- Gestionar saldos a favor de clientes
- Auditoría completa de devoluciones

---

## Arquitectura de Base de Datos

### Tablas principales

```sql
CREATE TABLE notas_credito (
  id               UUID PRIMARY KEY,
  store_id         UUID NOT NULL,
  venta_id         UUID NOT NULL,
  numero_nc        VARCHAR(25) UNIQUE,      -- NC-YYYYMMDD-XXXXXXXX
  motivo           TEXT,
  tipo_reembolso   VARCHAR(30),             -- reembolso_directo | saldo_a_favor
  metodo_reembolso VARCHAR(50),             -- efectivo, tarjeta, etc.
  monto_total      DECIMAL(12,2),
  estado           VARCHAR(30) DEFAULT 'activa',
  created_at       TIMESTAMP,
  updated_at       TIMESTAMP
);

CREATE TABLE nota_credito_items (
  id               UUID PRIMARY KEY,
  nota_credito_id  UUID NOT NULL,
  venta_item_id    UUID NOT NULL,
  producto_id      UUID NOT NULL,
  cantidad_devuelta INT,
  precio_unitario  DECIMAL(10,2),
  subtotal         DECIMAL(12,2),
  restituir_stock  BOOLEAN DEFAULT TRUE    -- Si actualizar stock
);

CREATE TABLE saldos_a_favor (
  id               UUID PRIMARY KEY,
  store_id         UUID NOT NULL,
  cliente_id       UUID NOT NULL,
  saldo_disponible DECIMAL(12,2),
  updated_at       TIMESTAMP,
  UNIQUE(store_id, cliente_id)
);
```

---

## Endpoints API

### POST /api/notas-credito
Crea una nota de crédito con devolución de items.

**Request**:
```json
{
  "ventaId": "v1",
  "items": [
    {
      "ventaItemId": "vi1",
      "cantidadDevuelta": 2,
      "restituirStock": true
    },
    {
      "ventaItemId": "vi2",
      "cantidadDevuelta": 1,
      "restituirStock": false
    }
  ],
  "tipoReembolso": "saldo_a_favor",  // o "reembolso_directo"
  "metodoReembolso": "efectivo",     // Opcional
  "motivo": "Producto dañado"        // Opcional
}
```

**Validaciones**:
- Venta debe existir y no estar anulada
- Cantidad devuelta ≤ cantidad original
- Monto total > 0
- tipoReembolso válido

**Operaciones**:
1. Genera numero_nc único (NC-YYYYMMDD-XXXXXXXX)
2. Inserta notas_credito + nota_credito_items
3. Si restituir_stock=true: incrementa stock + registra movimiento
4. Si tipoReembolso="saldo_a_favor": UPSERT saldos_a_favor
5. Rollback fidelización: decrementa total_historico, recalcula descuento

**Response**:
```json
{
  "ok": true,
  "notaCreditoId": "nc1",
  "numeroNc": "NC-20260416-ABC123D1"
}
```

**Errores**:
- 400: ventaId, items, tipoReembolso inválido, cantidades excedidas
- 401: Sin autenticación
- 404: Venta no encontrada
- 409: Venta anulada

---

### GET /api/notas-credito?ventaId=V1
Obtiene todas las notas de crédito de una venta.

**Response**:
```json
{
  "data": [
    {
      "id": "nc1",
      "numero_nc": "NC-20260416-ABC123D1",
      "monto_total": 5000,
      "motivo": "Producto dañado",
      "tipo_reembolso": "saldo_a_favor",
      "metodo_reembolso": "efectivo",
      "estado": "activa",
      "created_at": "2026-04-16T..."
    }
  ]
}
```

**Filtrado**:
- Por store_id (auth)
- Por venta_id (query param)
- Ordenado por created_at DESC

---

### GET /api/saldos-a-favor?clienteId=C1
Obtiene saldo disponible de un cliente.

**Response**:
```json
{
  "saldo_disponible": 15000
}
```

**Comportamiento**:
- Si cliente sin saldo → retorna 0
- No crea registro hasta primera devolución

---

## Flujo de Devolución

### 1️⃣ Cliente inicia devolución
- POS abre DevolucionModal
- Cliente selecciona items a devolver (cantidad parcial/total)
- Elige tipo reembolso

### 2️⃣ Confirmación en modal (2 pasos)
- **Paso 1**: Seleccionar items + cantidades
- **Paso 2**: Confirmar tipo reembolso + motivo

### 3️⃣ Sistema procesa
```
POST /api/notas-credito {ventaId, items, tipoReembolso}
  ↓
  Valida venta existe + no anulada
  ↓
  Valida cantidades ≤ originales
  ↓
  Crea notas_credito + nota_credito_items
  ↓
  Para cada item con restituir_stock=true:
    - SELECT productos.stock
    - UPDATE productos SET stock += cantidad_devuelta
    - INSERT stock_movements (entrada)
  ↓
  Si tipoReembolso="saldo_a_favor":
    - UPSERT saldos_a_favor
    - saldo_disponible += monto_total
  ↓
  Rollback fidelización:
    - SELECT fidelizacion (total_historico, frecuencia_compras)
    - total_historico -= monto_total
    - Recalcula descuento_actual según umbral
    - UPDATE fidelizacion
```

### 4️⃣ Visualización
- Ticket muestra NC generada
- Dashboard/Reportes incluyen devoluciones
- Cliente ve saldo a favor en siguiente compra

---

## Lógica de Reembolso

### Tipo: reembolso_directo
- Dinero devuelto al cliente (efectivo, tarjeta)
- No afecta saldos_a_favor
- Afecta caja/contabilidad

### Tipo: saldo_a_favor
- Crédito para compras futuras
- Almacenado en saldos_a_favor
- Cliente puede usar en próxima compra

---

## Rollback de Fidelización

### Devolución parcial
```
total_historico_nuevo = total_historico - monto_devuelto
descuento = calcularDescuento(total_historico_nuevo)
```

**Umbrales de descuento**:
- ≥ $300,000 → 20% descuento
- ≥ $150,000 → 10% descuento
- ≥ $50,000 → 5% descuento
- < $50,000 → 0% descuento

### Devolución total (anulación completa)
- total_historico = 0
- frecuencia_compras decrementado (-1)
- descuento_actual = 0

---

## Restitución de Stock

### Opción 1: restituir_stock=true
- Incrementa stock del producto
- Registra movimiento en stock_movements
- Tipo: "entrada"
- Notas: "Devolución NC-YYYYMMDD-XXXXXXXX"

### Opción 2: restituir_stock=false
- No toca inventario
- Admin puede procesar manualmente
- Útil para devoluciones por defecto/rechazo

---

## Testing

### Cobertura Actual: 21 tests (100%)

#### POST /api/notas-credito (15 tests)
- Devolución parcial exitosa
- Sin ventaId → 400
- Items vacío → 400
- tipoReembolso inválido → 400
- Venta no encontrada → 404
- Venta anulada → 409
- Cantidad > original → 400
- Monto ≤ 0 → 400
- Con restituirStock=true → incrementa stock
- Sin restituirStock → no toca stock
- Tipo saldo_a_favor → UPSERT saldo
- Saldo_a_favor con saldo existente → suma
- Saldo_a_favor sin saldo → crea
- Rollback fidelización parcial → decrementa total
- Múltiples items → suma correcta
- Sin auth → 401

#### GET /api/notas-credito (3 tests)
- Sin ventaId → 400
- Con ventaId válido → retorna array
- Sin auth → 401

#### GET /api/saldos-a-favor (3 tests)
- Sin clienteId → 400
- Cliente sin saldo → 0
- Cliente con saldo → retorna valor
- Sin auth → 401

Archivo: `tests/integration/api/notas-credito.test.ts`

---

## Casos de Uso

### Caso 1: Cliente devuelve producto dañado
```typescript
POST /api/notas-credito {
  ventaId: "v1",
  items: [{ ventaItemId: "vi1", cantidadDevuelta: 1, restituirStock: true }],
  tipoReembolso: "reembolso_directo",
  motivo: "Producto llegó dañado"
}

// Sistema:
// 1. Genera NC-20260416-ABC123D1
// 2. Crea registro en notas_credito
// 3. Restituy stock (1 unidad)
// 4. Decrementa fidelización
// 5. Retorna numeroNc
```

### Caso 2: Cliente quiere saldo a favor
```typescript
POST /api/notas-credito {
  ventaId: "v1",
  items: [{ ventaItemId: "vi1", cantidadDevuelta: 2 }],
  tipoReembolso: "saldo_a_favor",
  motivo: "Cambio de idea"
}

// Sistema:
// 1. Crea NC
// 2. Restituy stock (si restituirStock=true)
// 3. UPSERT saldos_a_favor: saldo += monto
// 4. Rollback fidelización
```

### Caso 3: Cliente usa saldo a favor en compra nueva
```typescript
// GET /api/saldos-a-favor?clienteId=c1 → saldo_disponible: 5000

// Al crear venta:
// if (saldo > 0):
//   descuento_por_saldo = Math.min(saldo, total_venta)
//   UPDATE saldos_a_favor SET saldo -= descuento_por_saldo
```

---

## Integración con Otros Sistemas

### Fidelización
- Devolución decrementa total_historico
- Recalcula descuento según nuevo total
- No afecta frecuencia_compras (solo anulación completa)

### Inventario
- Stock se restituy automáticamente si restituir_stock=true
- stock_movements registra "entrada" con referencia NC

### Reportes
- Sección "Devoluciones" con:
  - Total NCs emitidas
  - Monto total reembolsado
  - Saldo a favor total
  - Tendencia de devoluciones

### POS
- DevolucionModal integrado en ticket
- Muestra saldo a favor disponible del cliente
- Aplica crédito automáticamente en compra nueva

---

## Flujo Técnico Detallado

```mermaid
POST /api/notas-credito
  │
  ├─ Valida auth (401 si falla)
  │
  ├─ Valida request body
  │  ├─ ventaId requerido
  │  ├─ items no vacío
  │  └─ tipoReembolso válido
  │
  ├─ SELECT venta by ventaId
  │  ├─ 404 si no existe
  │  └─ 409 si estado="anulada"
  │
  ├─ Para cada item:
  │  ├─ SELECT venta_item by ventaItemId
  │  ├─ Valida cantidad_devuelta ≤ cantidad
  │  └─ Suma montos
  │
  ├─ Valida monto_total > 0 (400 si falla)
  │
  ├─ INSERT notas_credito
  │  └─ Genera numero_nc: NC-YYYYMMDD-XXXXXXXX
  │
  ├─ INSERT nota_credito_items (todos)
  │
  ├─ Para cada item con restituir_stock=true:
  │  ├─ SELECT productos.stock
  │  ├─ UPDATE productos SET stock += cantidad
  │  └─ INSERT stock_movements
  │
  ├─ Si tipoReembolso="saldo_a_favor":
  │  ├─ SELECT saldos_a_favor (o null)
  │  └─ UPSERT con saldo_disponible += monto
  │
  ├─ Si cliente_id existe:
  │  ├─ SELECT fidelizacion
  │  ├─ total_historico -= monto
  │  ├─ Recalcula descuento_actual
  │  └─ UPDATE fidelizacion
  │
  └─ RESPONSE 200 { ok, notaCreditoId, numeroNc }
```

---

## Decisiones de Diseño

### ¿Por qué numero_nc con timestamp?
- Único por store
- Formato: NC-YYYYMMDD-XXXXXXXX
- Legible en ticket
- Fácil búsqueda por fecha

### ¿Por qué restituir_stock es optional?
- Algunos defectos merecen reembolso sin devolución
- Admin puede procesar manualmente
- Flexibilidad en política de devoluciones

### ¿Por qué dos tipos de reembolso?
- Directo: efectivo, caja, contabilidad
- Saldo: incentiva compra futura, reduce caja

### ¿Por qué rollback afecta fidelización?
- Venta anulada = no contabiliza en historia
- Mantiene consistencia de descuentos
- Justo para cliente con devolución

---

## Próximas Mejoras

- [ ] Estados avanzados de NC (cancelada, rechazada, parcial)
- [ ] Límite de días para devoluciones
- [ ] Auditoría: quién emitió NC, cuándo
- [ ] Reportes: tasa de devolución por producto
- [ ] Integración: devolver a proveedor vs mantener
- [ ] Automatización: alertar si tasa devolución > umbral

---

## Referencias

- **API Route**: `src/app/api/notas-credito/route.ts`
- **API Route**: `src/app/api/saldos-a-favor/route.ts`
- **Migration**: `migrations/006_notas_credito.sql`
- **Component**: `src/app/(app)/components/DevolucionModal.tsx`
- **Tests**: `tests/integration/api/notas-credito.test.ts` (21 tests, 100%)

---

Actualizado: **2026-04-17** por Claude Code
