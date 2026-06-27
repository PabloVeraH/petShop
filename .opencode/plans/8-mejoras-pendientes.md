# Plan: 8 Mejoras Pendientes

## Estado
- Commit base: `8e9a2b4` (fix(ui): add confirmation modal before deleting category)
- Branch: `develop`
- Tests: 1240 pasan, build OK
- Última sesión: investigué los 8 items, el usuario aprobó ejecutar todo

## Pendiente de ejecutar (orden óptimo)

### 1. Item 8: "Gracias por su compra" en anuladas
- **File**: `src/app/(app)/sales/[id]/page.tsx:291-293`
- **Fix**: Reemplazar `<p>Gracias por su compra!</p>` con ternario según `estado !== "anulada"`
- **Test**: VT-01/VT-02 en SalesTicketPage test
- **Spec-registry**: agregar VT-XX entries

### 2. Item 1: Badge "Sin costo" en inventario
- **File**: `src/app/(app)/inventory/page.tsx:~373-379`
- **Fix**: Agregar `<Badge>Sin costo</Badge>` junto al "Sin precio" existente (cuando `p.costo === null || p.costo === 0`)
- **Test**: IV-01 en InventoryPage test

### 3. Item 2: Meta mensual visible para admins
- **File**: `src/app/(app)/vendedores/page.tsx:234`
- **Fix**: Remover `selectedWorker?.store_worker &&` del wrapper del campo meta_ventas
- **Test**: VD-01: verificar que meta_ventas input aparece para store_admin

### 4. Item 4: PedidosYa placeholders con formato
- **File**: `src/app/(app)/canales/[canal]/page.tsx:36-40`
- **Fix**: Cambiar `"..."` por `"pedidosya_cliente_123"`, `"py_secret_..."`, `"123456"`
- **Test**: Cosmético, test opcional

### 5. Item 5: "Manage account" a español (Clerk)
- **File**: `src/app/(app)/layout.tsx:97` (UserButton) o el provider donde esté ClerkProvider
- **Fix**: Buscar `ClerkProvider`, agregar `localization={esES}` importando de `@clerk/localizations`
- **Test**: Ninguno (componente de Clerk)

### 6. Item 6: Evitar mascotas duplicadas
- **File**: `src/app/api/mascotas/route.ts:69-82`
- **Fix**: Antes del INSERT, verificar si existe `(cliente_id, nombre)` → 409 si ya existe
- **Test**: I-NNN: POST misma mascota dos veces → 409

### 7. Item 3: PDF/Excel en Estado de Resultado
- **Files**: `src/app/(app)/contabilidad/page.tsx:453-512` + nueva API route
- **Fix**: 
  - Crear `/api/contabilidad/estado-resultado/excel` (similar a balance-prueba)
  - Agregar botones en la UI
- **Test**: I-NNN integration + CD-XX component

### 8. Item 7: Notas internas en POS venta
- **Files**: Múltiples (ver investigación)
- **Fix**:
  - `src/app/(app)/pos/page.tsx`: agregar campo de notas en ModalPago/carrito
  - `src/app/(app)/pos/api.ts`: agregar `notas` a createVenta()
  - `src/app/api/ventas/route.ts`: extraer `notas` del body, UPDATE post-RPC
  - NO necesita migration (columna `notas` ya existe en ventas)
- **Test**: I-NNN integration + PS-XX component

## Archivos relevantes ya investigados
- Sales ticket: `src/app/(app)/sales/[id]/page.tsx`
- Inventory: `src/app/(app)/inventory/page.tsx`
- Vendedores: `src/app/(app)/vendedores/page.tsx`
- Canales: `src/app/(app)/canales/[canal]/page.tsx`
- Layout: `src/app/(app)/layout.tsx`
- Mascotas API: `src/app/api/mascotas/route.ts`
- Contabilidad: `src/app/(app)/contabilidad/page.tsx`
- POS: `src/app/(app)/pos/page.tsx`, `src/app/(app)/pos/api.ts`
- Ventas API: `src/app/api/ventas/route.ts`
