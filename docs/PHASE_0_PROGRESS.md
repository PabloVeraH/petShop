# FASE 0: Refactor Base — Canal como Concepto Central

**Fecha inicio:** 2026-04-18  
**Última actualización:** 2026-04-18 (16:35)  
**Estado:** En progreso (65% — BD + Core + APIs + Contabilidad completado)  
**Objetivo:** Reemplazar `productos.precio`, agregar `canal` a `ventas`, actualizar UI. Base de todo lo demás.  
**Rama:** develop

---

## 📋 Checklist de Tareas

### 1. BASE DE DATOS (Pasos de migración)

#### Paso 1: Limpiar datos de prueba
- [ ] Generar migración SQL para truncate
- [ ] Ejecutar limpieza
- **Commit:** `db: clean test data`

#### Paso 2: Tablas del Hub de Canales ✅
- [x] Crear tabla `canales_externos`
- [x] Crear tabla `canal_config`
- [x] Crear tabla `canal_producto_config`
- [x] Crear tabla `canal_ordenes`
- [x] Crear tabla `stock_reservas`
- [x] Crear tabla `canal_liquidaciones`
- **Commit:** ✅ `6f9cfc9` — db: add multi-channel hub tables

#### Paso 3: Modificar tablas existentes ✅
- [x] ALTER productos: DROP COLUMN precio (opcional, guardar como reference)
- [x] ALTER ventas: ADD COLUMN canal TEXT
- [x] ALTER journal_entries: ADD COLUMN canal TEXT
- [x] ALTER ventas: ADD metodo_pago='plataforma' al ENUM/CHECK
- [x] ALTER notas_credito: ADD metodo_reembolso='plataforma' al ENUM/CHECK
- **Commit:** ✅ `6f9cfc9` — db: modify existing tables for multi-channel

#### Paso 4: Nuevas cuentas contables ✅
- [x] INSERT cuentas por cobrar por canal (110401, 110402, 110403)
- [x] INSERT comisiones por canal (510101, 510102, 510103)
- [x] INSERT devoluciones canal externo (510201)
- **Commit:** ✅ `6f9cfc9` — db: add new accounts for channels

#### Paso 5: Índices para rendimiento ✅
- [x] Crear índices de performance
- **Commit:** ✅ `6f9cfc9` — db: add channel indexes

#### Paso 6: RLS Policies ✅
- [x] Habilitar RLS en canal_config
- [x] Habilitar RLS en canal_producto_config
- [x] Habilitar RLS en canal_ordenes
- [x] Habilitar RLS en canal_liquidaciones
- **Commit:** ✅ `6f9cfc9` — db: enable RLS on channel tables

### 2. BACKEND

#### Core Library ✅
- [x] `src/lib/canales/types.ts` — IExternalChannel, tipos completos
- [x] `src/lib/canales/encryption.ts` — AES-256-GCM
- [x] `src/lib/canales/registry.ts` — registry con ENABLED_CHANNELS
- [x] `src/lib/canales/hub.ts` — lógica de negocio
- [x] `src/lib/canales/pos/adapter.ts` — PosChannel mínimo
- **Commit:** ✅ `5479381` — feat: core channel library

#### APIs ✅
- [x] `src/app/api/ventas/route.ts` — actualizar para leer precio de canal_producto_config
- [x] `src/app/api/productos/route.ts` — guardar precio en canal_producto_config
- [x] `src/app/api/canales/config/route.ts` — GET/POST/PATCH credenciales
- **Commit:** ✅ `498de6b` — feat: update APIs for canal_producto_config

#### Contabilidad ✅
- [x] `src/lib/contabilidad/generador-asientos.ts` — agregado lineasVentaCanal con cuentas por canal
- [x] `src/app/api/contabilidad/libro-diario/route.ts` — filtro ?canal=
- [x] `src/app/api/notas-credito/route.ts` — metodo_reembolso='plataforma'
- **Commit:** ✅ `498de6b` (tipos y lineasVentaCanal) + `652ca15` (libro-diario, notas-credito)

#### Cron Jobs
- [ ] Expiración automática de stock_reservas (cada 2 min)
- **Commit:** `feat: stock reservation expiry cron`

### 3. FRONTEND

#### Formularios
- [ ] Actualizar formulario producto: "Precio de venta" → "Precio presencial"
- **Commit:** `refactor: rename product price field to presencial`

#### UI
- [ ] Nuevo módulo `/canales/page.tsx` — tarjetas de estado por canal
- [ ] `Settings → Integraciones` — tabla de canales (solo admin)
- [ ] Dashboard: widget "Ventas por canal hoy"
- [ ] Reportes: agregar filtro `canal`
- [ ] Contabilidad: agregar filtro `canal`
- **Commit:** `feat: multi-channel UI pages and widgets`

### 4. TESTS

#### Unitarios
- [ ] Tests de `encryption.ts` — cifrar/descifrar round-trip
- [ ] Tests de `registry.ts` — filtro ENABLED_CHANNELS
- [ ] Tests de `hub.ts` — reserva de stock, liberación, cancelación
- **Commit:** `test: channel library unit tests`

#### Integración
- [ ] Actualizar tests ventas POST: enviar `canal: "pos"`, verificar lectura de precio
- [ ] Actualizar tests productos POST/PATCH: verificar `canal_producto_config`
- [ ] Tests de webhook HMAC validation (preparar para Fase 1)
- **Commit:** `test: integration tests for multi-channel`

---

## 📊 Estado General

| Sección | Estado | Bloqueos | Notas |
|---------|--------|----------|-------|
| BD — Pasos 1-6 | ✅ COMPLETADO | — | 4 migraciones creadas |
| Backend Core | ✅ COMPLETADO | — | types, encryption, registry, hub, pos adapter |
| Backend APIs | ✅ COMPLETADO | — | ventas, productos, canales/config |
| Contabilidad | ✅ COMPLETADO | — | lineasVentaCanal, libro-diario, notas-credito |
| Cron Jobs | ⬜ Pendiente | — | stock_reservas expiry |
| Frontend | ⬜ Pendiente | — | formularios, UI, reportes |
| Tests | ⬜ Pendiente | Backend | — |

---

## 📝 Notas de Ejecución

### Pre-requisitos Técnicos
- [ ] Confirmar que TODOS los datos son de prueba y pueden borrarse
- [ ] Definir `ENCRYPTION_KEY` en `.env` (32 bytes aleatorios)
- [ ] Decidir política de stock mínimo (recomendado: desactivar en canales cuando stock <= 0)
- [ ] Revisar tests fallantes actuales (28 tests fallantes según doc)

### Convenciones de Commits
```
db: <descripción>           # Cambios de base de datos
feat: <descripción>         # Nuevas características
refactor: <descripción>     # Refactorización
test: <descripción>         # Tests
fix: <descripción>          # Correcciones
```

### Patrón de Ejecución
1. **BD primero:** todo depende del schema
2. **Types.ts segundo:** el contrato para el rest
3. **Core library:** encryption, registry, hub
4. **APIs:** exponen la lógica
5. **Frontend:** consumen las APIs
6. **Tests:** validar todo

---

## 🔗 Documentos Relacionados

- **Propuesta:** `/home/pablete/Documentos/Bobeda Obsidian/Obsidian/proyectos/petShop/rappi-integration-proposal.md`
- **Secciones relevantes:**
  - §4: Base de Datos (migración)
  - §3.2: IExternalChannel interface
  - §3.3: Estructura de archivos
  - §5: Sistema de canales configurables
  - §6: Impacto en módulos existentes

---

**Última actualización:** 2026-04-18 (inicio de Fase 0)
