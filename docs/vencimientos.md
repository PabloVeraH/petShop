---
tags:
  - petshop
  - vencimientos
  - funcionalidad
---

# petShop — Sistema de Control de Vencimientos

Documentación completa del sistema de control de fechas de vencimiento para productos perecederos (comida, medicamentos, etc.).

---

## Descripción General

El sistema permite:
- Asignar fecha de vencimiento opcional a productos
- Configurar días de anticipación para alertas (dias_alerta)
- Clasificar productos: vigentes, próximos a vencer, vencidos
- Aplicar ofertas manuales (precio_oferta con descuento)
- Visualizar vencimientos en inventario con badges color-coded
- Recibir alertas WhatsApp de vencimientos próximos
- Reportar datos de vencimientos en estadísticas

---

## Arquitectura de Base de Datos

### Campos en tabla `productos`

```sql
ALTER TABLE productos ADD COLUMN IF NOT EXISTS:
  - fecha_vencimiento DATE           NULL,
  - dias_alerta       INTEGER        DEFAULT 30,
  - precio_oferta     DECIMAL(10,2)  NULL,
  - en_oferta         BOOLEAN        DEFAULT FALSE;

CREATE INDEX idx_productos_vencimiento ON productos(fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL AND activo = TRUE;
```

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `fecha_vencimiento` | DATE | NULL | Fecha de vencimiento (NULL si no aplica) |
| `dias_alerta` | INTEGER | 30 | Días de anticipación para alertas |
| `precio_oferta` | DECIMAL(10,2) | NULL | Precio rebajado manual (NULL si no hay oferta) |
| `en_oferta` | BOOLEAN | FALSE | Flag activo para mostrar precio_oferta |

---

## Clasificación de Vencimiento

### Estados por producto

| Estado | Condición | Color | Uso |
|--------|-----------|-------|-----|
| **Vigente** | `fecha_vencimiento == NULL` | Gris | Productos no perecederos |
| **Vigente** | Días restantes > `dias_alerta` | Verde | Suficiente stock, sin alerta |
| **Próximo** | `0 < días restantes ≤ dias_alerta` | Ámbar | Requiere atención pronto |
| **Vencido** | `fecha_vencimiento < hoy` | Rojo | Debe retirarse del inventario |

### Lógica de cálculo

```typescript
function getVencimientoStatus(fechaVencimiento: string | null, diasAlerta: number): Status {
  if (!fechaVencimiento) return { label: null, color: null };
  
  const hoy = new Date().toISOString().split("T")[0];
  const diasRestantes = Math.ceil(
    (new Date(fechaVencimiento).getTime() - new Date(hoy).getTime()) / 86400000
  );
  
  if (diasRestantes < 0) return { label: "vencido", color: "red" };
  if (diasRestantes <= diasAlerta) return { 
    label: "proximo", 
    color: "amber", 
    diasRestantes 
  };
  return { label: "vigente", color: "green" };
}
```

---

## Endpoints API

### GET /api/dashboard/vencimientos
Retorna clasificación de productos vencidos y próximos a vencer.

**Parámetros**: None (autenticación por JWT)

**Respuesta**:
```json
{
  "vencidos": [
    {
      "id": "p1",
      "nombre": "Leche",
      "sku": "LCH-001",
      "stock": 5,
      "fecha_vencimiento": "2026-04-15",
      "dias_alerta": 7
    }
  ],
  "proximos": [
    {
      "id": "p2",
      "nombre": "Medicina",
      "sku": "MED-001",
      "stock": 3,
      "fecha_vencimiento": "2026-04-20",
      "dias_alerta": 30,
      "diasRestantes": 4
    }
  ],
  "totalUnidadesVencidas": 5,
  "hoy": "2026-04-16"
}
```

**Filtrado**:
- Solo productos con `activo = true`
- Excluye productos con `stock = 0`
- Respeta `dias_alerta` por producto
- Ordena por `fecha_vencimiento ASC`

---

### POST/PATCH /api/productos
CRUD de productos con campos de vencimiento.

**POST — Crear producto**:
```json
{
  "nombre": "Leche Integral",
  "sku": "LCH-001",
  "precio": 2500,
  "stock": 10,
  "fecha_vencimiento": "2026-05-15",  // Opcional
  "dias_alerta": 7,                    // Default 30 si omitido
  "precio_oferta": 2000,               // Opcional
  "en_oferta": true
}
```

**PATCH — Actualizar producto**:
```json
{
  "fecha_vencimiento": "2026-06-01",
  "dias_alerta": 14,
  "precio_oferta": 1800,
  "en_oferta": false
}
```

---

### GET /api/inventario?vencimiento=1
Lista productos filtrados por vencimiento.

**Query parameters**:
- `vencimiento=1` → Mostrar solo productos con `fecha_vencimiento IS NOT NULL`
- Sin parámetro → Mostrar todos

**Respuesta**: Array de productos con columna adicional `vencimiento` (estado color-coded)

---

### GET /api/reports
Estadísticas con sección de vencimientos.

**Respuesta incluye**:
```json
{
  "vencimientos": {
    "vencidos": [...],
    "proximos": [...],
    "totalUnidadesVencidas": 15,
    "diasPromedio": 5
  }
}
```

---

### POST /api/whatsapp/send-alerts
Envía notificaciones WhatsApp de vencimientos a la tienda.

**Trigger**: Cron manual o desde settings

**Lógica**:
1. Consulta productos con `fecha_vencimiento ≤ hoy + 14 días`
2. Filtra en JS según `dias_alerta` individual
3. Si hay resultados, envía mensaje a teléfono de tienda
4. Formato mensaje:
   ```
   *Pet Store* ⏰
   
   Alerta de Vencimientos:
   
   🔴 VENCIDOS (2 productos):
   • Leche (SKU: LCH-001) - 5 ud.
   • Pan (SKU: PAN-001) - 3 ud.
   
   🟡 PRÓXIMOS A VENCER (3 productos):
   • Medicina (SKU: MED-001) - vence en 4d
   • Yogur (SKU: YGR-001) - vence en 7d
   
   Revisa el dashboard para más detalles.
   ```

---

## UI/UX Components

### Inventario — Columna "Vencimiento"

**Estados visuales**:
- `null` → "—" (text-gray-400)
- Vigente → "vence 2026-05-15" (text-green-600)
- Próximo → "⚠ 4 días" (badge ámbar)
- Vencido → "✕ Vencido" (badge rojo)

**Modal create/edit** — Campos opcionales:
- `fecha_vencimiento` (input type="date")
- `dias_alerta` (input number min=1, visible si fecha_vencimiento ≠ null, default 30)
- `precio_oferta` (input number, placeholder "Precio rebajado")
- `en_oferta` (checkbox, visible si precio_oferta > 0)

**Filtro toolbar** — Toggle "Solo vencimientos":
- Activa query `?vencimiento=1`
- Muestra solo productos con fecha_vencimiento NOT NULL

---

### Dashboard — Sección "⏰ Vencimientos"

Dos listas bajo sección de alertas:

1. **Vencidos** (rojo, máx 10 items)
   - Producto nombre
   - Stock actual
   - Fecha vencimiento
   - Botón "Editar" para cambiar precio_oferta

2. **Próximos** (ámbar, máx 10 items)
   - Producto nombre
   - Días restantes
   - Fecha vencimiento
   - Botón "Editar" para configurar alerta

Query: `GET /api/dashboard/vencimientos`

---

### POS (Punto de Venta)

**Cards de productos**:
- Vencido: Badge rojo "⚠ Vencido" inline
- Próximo: Badge ámbar "⚠ 4 días"
- Vigente: Sin badge

**Carrito**:
- Si producto vencido → Muestra badge rojo "⚠ Vencido"
- Si `en_oferta = true` → Usa `precio_oferta` en cálculo
  - Muestra precio tachado `precio` y resaltado `precio_oferta` en verde

**Nota**: No bloquea la venta de productos vencidos, solo alerta visual.

---

### SearchProductos

Cards color-coded por estado:
- Verde: Vigentes
- Ámbar: Próximos a vencer
- Rojo: Vencidos

Muestra `diasRestantes` en badge sobre card.

---

## Testing

### Cobertura Actual: 40 tests (100%)

#### Unit Tests (27 tests)
- `getVencimientoStatus()` — 8 tests
- `clasificarProductos()` — 12 tests
- `diasRestantes()` — 7 tests

Archivo: `tests/unit/lib/vencimiento-helpers.test.ts`

#### Integration Tests (13 tests)
- `GET /api/dashboard/vencimientos` — 13 tests
  - I-100: Estructura respuesta
  - I-101: Filtrado store_id
  - I-102: Exclusión stock=0
  - I-103: Respeto dias_alerta por producto
  - I-104: Cálculo diasRestantes
  - I-105: Orden por fecha_vencimiento
  - I-106: Inclusión precio_oferta/en_oferta
  - I-107: Array vacío
  - I-108: Auth (401 sin token)
  - I-109: Error Supabase (500)
  - I-110: Timestamp "hoy" YYYY-MM-DD
  - I-111: Próximos incluye vencidos con stock
  - I-112: Total unidades vencidas

Archivo: `tests/integration/api/vencimientos.test.ts`

---

## Casos de Uso

### Caso 1: Crear producto perecedero con alerta
```typescript
// Admin crea leche con vencimiento en 7 días
POST /api/productos {
  nombre: "Leche Integral 1L",
  precio: 2500,
  stock: 20,
  fecha_vencimiento: "2026-04-23",
  dias_alerta: 7,  // Alertar 7 días antes
  sku: "LCH-INT-1L"
}

// Dashboard muestra en 7 días como "Próximo"
// Cuando falten 7 días → Ámbar en inventario
// Al vencer → Rojo "✕ Vencido"
```

### Caso 2: Activar oferta en producto próximo a vencer
```typescript
// Admin ve producto próximo a vencer
// Reduce precio para vender rápido
PATCH /api/productos/p1 {
  precio_oferta: 1500,    // Rebaja $1000
  en_oferta: true
}

// POS muestra precio tachado + descuento
// Carrito calcula con precio_oferta
```

### Caso 3: Recibir alerta WhatsApp
```
Cron: POST /api/whatsapp/send-alerts (manual o scheduled)

Endpoint consulta productos vencidos/próximos
→ Envía mensaje al teléfono de tienda
→ Admin revisa dashboard e impulsa ventas

Mensaje:
🔴 VENCIDOS (2 ud.)
🟡 PRÓXIMOS A VENCER (5 ud.)
```

---

## Decisiones de Diseño

### ¿Por qué `dias_alerta` es per-producto?
Diferentes productos tienen duraciones diferentes:
- Leche: 7 días de anticipación
- Medicinas: 90 días de anticipación
- Pan: 3 días

Cada producto define su propio umbral.

### ¿Por qué no automatizar ofertas?
Las ofertas son decisiones comerciales del admin:
- No todos los productos vencidos deben tener descuento
- Admin decide si vender con descuento o descartar
- Ofertas manuales mantienen control sobre márgenes

### ¿Por qué no bloquear ventas de vencidos?
Contexto: Pet shop puede tener productos con corta duración:
- Alimentos frescos pueden ser "seguros" días después de vencimiento
- Admin decide si es vendible
- Solo alerta visual en UI, decisión humana final

---

## Integración con Otros Sistemas

### Fidelización
- Venta de producto vencido NO afecta fidelización
- Admin asume riesgo de vender vencido

### Devoluciones
- Si cliente devuelve producto vencido:
  - Restituir stock completamente
  - Rollback descuento fidelización normal

### Reportes
- Sección "Vencimientos" en `/api/reports`
- CSV export incluye estado vencimiento
- Tendencias de desperdicio (vencidos no vendidos)

---

## Próximas Mejoras

- [ ] Historial de productos vencidos (auditoría)
- [ ] Alertas automáticas por email además de WhatsApp
- [ ] Proyección: "En 7 días se vencerán X unidades"
- [ ] Integración con proveedores (reorden automática)
- [ ] Análisis: productos que se vencen frecuentemente

---

## Referencias

- **Plan**: `/home/pablete/.claude/plans/velvety-snacking-eclipse.md`
- **Tests**: `docs/tests.md` — Cobertura completa (40 tests, 100%)
- **API Routes**: 
  - `src/app/api/dashboard/vencimientos/route.ts`
  - `src/app/api/productos/route.ts`
  - `src/app/api/inventario/route.ts`
- **Components**: 
  - `src/app/(app)/inventory/page.tsx`
  - `src/app/(app)/dashboard/page.tsx`
  - `src/app/(app)/pos/page.tsx`

---

Actualizado: **2026-04-16** por Claude Code
