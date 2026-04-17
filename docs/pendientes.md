---
tags:
  - petshop
  - pendientes
---

# petShop — Pendientes y roadmap

## ✅ Completado (MVP — Fase 1 + Devoluciones + Vencimientos + Testing)

- [x] Admin panel con gestión de tienda
- [x] Sidebar navigation (Tienda, Usuarios)
- [x] Edición de información de tienda (view/edit mode)
- [x] Creación de usuarios con roles (systemAdmin, storeAdmin, storeWorker)
- [x] Eliminación de usuarios (optimistic update)
- [x] Permisos basados en rol RBAC
- [x] Sincronización Clerk ↔ Supabase
- [x] Hook useAdminAuth centralizado
- [x] API endpoints: `/api/admin/users/create`, `/api/admin/stores/[id]`, `/api/admin/users/[id]`
- [x] README.md con guía de setup local y Vercel deployment
- [x] Obsidian knowledge base structure
- [x] **Sistema de Devoluciones y Notas de Crédito**
  - [x] Tabla `notas_credito` con encabezado de devoluciones
  - [x] Tabla `nota_credito_items` para ítems devueltos
  - [x] Tabla `saldos_a_favor` para crédito cliente
  - [x] Devoluciones parciales con selección de ítems
  - [x] Dos tipos de reembolso (saldo a favor / directo)
  - [x] Restitución automática de stock por ítem
  - [x] Rollback de fidelización
  - [x] DevolucionModal component (2 pasos)
  - [x] Visualización de NCs en ticket y saldo disponible
- [x] **Sistema de Control de Vencimientos**
  - [x] Campos en productos: fecha_vencimiento, dias_alerta, precio_oferta, en_oferta
  - [x] Endpoint GET /api/dashboard/vencimientos con clasificación vencidos/próximos
  - [x] Endpoint GET /api/inventario con filtro ?vencimiento=1
  - [x] Columna vencimiento en inventario con badges color-coded
  - [x] Modal de edición con campos condicionales (fecha, días alerta, oferta)
  - [x] Toggle filtro "Solo vencimientos" en inventario
  - [x] Sección Vencimientos en dashboard con listas vencidos/próximos
  - [x] Reporte en /api/reports con datos de vencimientos
  - [x] Cards en SearchProductos con colores vencidos/próximos
  - [x] Carrito muestra badges vencido + precio_oferta con tachado
  - [x] WhatsApp alerts notificaciones vencimientos a tienda

---

## ✅ Testing Suite — TDD Completo (2026-04-16)

### Vencimientos — Tests ✅
- [x] Helper functions testing (27 tests — 100% coverage)
  - getVencimientoStatus() con casos vigente/próximo/vencido
  - clasificarProductos() con filtrado stock
  - diasRestantes() con transiciones mes/año
- [x] API endpoint testing (13 tests — 100% coverage)
  - GET /api/dashboard/vencimientos con clasificación
  - Filtrado store_id, exclusión stock=0
  - Respeto dias_alerta por producto
  - Inclusión precio_oferta/en_oferta

### Otras Suites ✅
- [x] Productos (15 tests — 95% coverage) — vencimientos
- [x] Ventas (18 tests — 92% coverage)
- [x] Admin (12 tests — 90% coverage)
- [x] Inventario (8 tests — 88% coverage)
- [x] Clientes (11 tests — 85% coverage)
- [x] Seguridad (9 tests — 100% coverage)
- [x] Validación (6 tests — 100% coverage)
- [x] Dashboard (8 tests — 84% coverage)
- [x] Reports (6 tests — 89% coverage)
- [x] Onboarding (5 tests — 87% coverage)
- [x] Hub Sync (7 tests — 90% coverage)

### Documentación ✅
- [x] tests.md — Historial completo, patrones, ejecución
- [x] MEMORY.md — Índice actualizado con tests

### Estado Final — 2026-04-17 ✅✅
- **Total**: 172 tests
- **Pasando**: 172 (100%)
- **Fallos**: 0 ✅

### Sesión 1 (2026-04-16) — Vencimientos + Tests Base
- [x] Arreglar WhatsApp send-alerts mocks (consolidar 2 queries → 1, refactor mock per-tabla)
- [x] Arreglar Reports mocks (agregar .not() al chain)
- [x] Documentación vencimientos.md (40 tests: 27 unitarios + 13 API)
- [x] Actualizar tests.md, MEMORY.md con estado 151/151 ✅

### Sesión 2 (2026-04-17) — Devoluciones + 21 Tests
- [x] Suite completa notas-credito.test.ts (21 tests, 100%)
- [x] Documentación devoluciones.md (notas crédito, reembolsos, saldo a favor)
- [x] Actualizar tests.md, MEMORY.md con estado 172/172 ✅
- [x] Verificar build sin errores TypeScript

### Próximas Prioridades (Fase 2.4+)
- [ ] Componentes React — E2E testing con Playwright
- [ ] Métodos de pago en POS (efectivo, tarjeta, transferencia)
- [ ] Recibos/facturas con impresión térmica
- [ ] Integración saldos a favor en POS (usar crédito en compra)

---

## 🚀 Fase 2.3 — POS Completo (Point of Sale)

- [x] SearchProductos con filtro y cards color-coded (vencimientos)
- [x] Carrito con badges y precio_oferta automático
- [ ] Métodos de pago (efectivo, tarjeta, transferencia)
- [ ] Recibos/facturas
- [ ] Integración con saldos a favor (usar crédito del cliente)
- [ ] Devoluciones desde POS

---

## 📦 Fase 3 — Inventario

- [ ] Tabla `products` en Supabase
- [ ] CRUD de productos (nombre, descripción, precio, SKU, stock)
- [ ] Categorización de productos
- [ ] Control de stock / Bajo stock alerts
- [ ] Histórico de movimientos

---

## 📊 Fase 4 — Reportes y Analytics

- [ ] Dashboard del administrador con KPIs
- [ ] Ventas diarias/mensuales
- [ ] Productos más vendidos
- [ ] Ingresos totales
- [ ] Reportes exportables (PDF, CSV)

---

## 🔧 Configuración de producción (antes de deploy)

- [ ] **Deploy en Vercel** — conectar repo, configurar env vars
- [ ] `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — Clerk production
- [ ] `CLERK_SECRET_KEY` — Clerk secret
- [ ] Supabase project production (URL y keys)
- [ ] `NEXT_PUBLIC_APP_URL` — URL de producción
- [ ] Verificar RLS policies en Supabase producción

---

## 💡 Backlog / ideas evaluadas

- [ ] **Permisos granulares** — ej: storeAdmin puede ver reportes, pero no crear systemAdmin
- [ ] **Auditoría** — log de cambios (quién editó qué y cuándo)
- [ ] **Deshabilitar usuarios** — soft delete, no eliminar
- [ ] **Integración con Google Sheets** — exportar inventario/ventas
- [ ] **Mobile app** — React Native o PWA
- [ ] **Notificaciones en tiempo real** — Supabase Realtime
- [ ] **Multi-tienda** — expandir de una tienda a varias (admin puede switch)
- [ ] **Temas personalizables** — colores y branding por tienda

---

## 🐛 Mejoras técnicas

- [x] Tests unitarios (Jest + React Testing Library) — 151 tests (97.4% pasando)
- [ ] E2E tests (Playwright o Cypress)
- [ ] GitHub Actions CI/CD con tests
- [ ] Tipos Supabase generados (`supabase gen types typescript`)
- [ ] Logging estructurado (Pino, Winston)
- [ ] Error tracking (Sentry)
- [ ] Performance monitoring (Web Vitals)
- [ ] Aumentar coverage > 90% (actualmente 85% promedio)

---

## 📝 Documentación pendiente

- [ ] API documentation (OpenAPI/Swagger)
- [ ] Database schema diagram
- [ ] Onboarding de nuevas tiendas (guía)
- [ ] Troubleshooting guide en wiki

---

## 🔐 Seguridad y compliance

- [ ] RLS policies audit en Supabase
- [ ] Validación de entrada en todos los endpoints
- [ ] Rate limiting en API
- [ ] HTTPS en producción (Vercel by default)
- [ ] GDPR compliance (data export, deletion)
- [ ] Cifrado de datos sensibles
