# petShop — Sistema de Gestión para Tiendas de Mascotas

Sistema integral de gestión para tiendas de mascotas con autenticación, punto de venta, inventario, usuarios y reportes.

**Tech Stack**: Next.js 16 • React 19 • TypeScript • Tailwind CSS • Clerk • Supabase • tanstack-query

---

## 🚀 Inicio Rápido

### Requisitos
- **Node.js** ≥ 20.9 (requisito de Next.js 16)
- **npm**
- **Clerk** (autenticación) — [obtener credenciales](https://dashboard.clerk.com)
- **Supabase** (base de datos) — [crear proyecto](https://app.supabase.com)

> **Instalar el sistema a una tienda nueva** (rama, Supabase, Clerk y Vercel
> propios, y cómo actualizarla desde `main`): ver
> [`docs/INSTALACION_TIENDA.md`](docs/INSTALACION_TIENDA.md).

### Instalación Local

```bash
npm install
```

### Variables de Entorno

Crea `.env.local` en la raíz del repo. La lista completa de variables está en
[`docs/INSTALACION_TIENDA.md` — Anexo A](docs/INSTALACION_TIENDA.md#anexo-a-variables-de-entorno).
Mínimo para levantar en local:

```env
# Clerk (instancia de desarrollo)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/auth/login
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/auth/signup
CLERK_WEBHOOK_SECRET=whsec_...

# Supabase (Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# openssl rand -hex 32
ENCRYPTION_KEY=
CRON_SECRET=
```

### Desarrollo Local

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) en el navegador.

### Build & Producción

```bash
# Build optimizado
npm run build

# Servir producción localmente
npm start
```

---

## 📋 Funcionalidades

### Autenticación & Roles
- **systemAdmin**: Administrador del sistema (manage tiendas, usuarios, reportes)
- **storeAdmin**: Gerente de tienda (edita tienda, gestiona storeWorkers)
- **storeWorker**: Operador de caja (acceso a POS)

### Panel de Administración (`/admin`)
- 📋 **Mi Tienda**: Editar información (nombre, RUT, email, teléfono, WhatsApp)
- 👥 **Gestión de Usuarios**: Crear, listar, eliminar usuarios por rol
- Permisos granulares según rol del usuario

### Punto de Venta (`/pos`)
- Crear ventas rápidas
- Buscar productos en tiempo real
- Métodos de pago múltiples
- Asociar mascotas a compras

### Inventario (`/inventory`)
- Gestión de productos (crear, editar, eliminar)
- Stock y alertas de mínimo
- SKU único por producto
- Movimientos de stock

### Clientes & Mascotas
- Base de datos de clientes con RUT
- Registrar mascotas por cliente
- Historial de compras

### Reportes
- Ventas por período
- Productos más vendidos
- Clientes frecuentes
- Exportar a CSV/Excel

---

## 🏗️ Arquitectura

```
petShop/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (app)/                    # Protected routes (requieren auth)
│   │   │   ├── admin/                # Admin panel
│   │   │   ├── dashboard/            # Dashboard
│   │   │   ├── pos/                  # Punto de venta
│   │   │   ├── inventory/            # Inventario
│   │   │   └── ...
│   │   ├── auth/                     # Clerk auth pages (login, signup)
│   │   ├── api/                      # API routes
│   │   │   ├── admin/                # Admin endpoints
│   │   │   ├── ventas/               # Sales endpoints
│   │   │   ├── productos/            # Products endpoints
│   │   │   └── ...
│   │   └── middleware.ts             # Role-based routing
│   ├── components/                   # React components
│   │   ├── admin/                    # Admin components
│   │   └── ui/                       # UI primitives
│   ├── hooks/                        # Custom hooks
│   │   └── useAdminAuth.ts           # Auth & permissions
│   ├── lib/                          # Utilities
│   │   ├── supabase.ts               # Supabase client
│   │   ├── auth.ts                   # Auth helpers
│   │   └── ...
│   └── types/                        # TypeScript types
├── public/                           # Static assets
├── tests/                            # Jest test suite
├── migrations/                       # SQL (ver nota en Base de Datos)
├── package.json
└── tsconfig.json
```

---

## 🗄️ Base de Datos

**Tablas principales:**
- `stores` — Información de tienda
- `products` — Catálogo de productos
- `clients` — Base de clientes
- `mascotas` — Mascotas registradas
- `ventas` — Transacciones de venta
- `clerk_users` — Sincronización de usuarios Clerk

`migrations/` contiene el historial de cambios, pero **no reproduce el
esquema completo desde cero** (hay cambios aplicados fuera de esa carpeta).
Una base nueva se crea con un dump del esquema del demo: ver
`docs/INSTALACION_TIENDA.md` §3.

---

## 🔑 Configuración y despliegue

El paso a paso completo (Supabase, Clerk, Vercel, servicios externos,
verificación y actualización) está en
[`docs/INSTALACION_TIENDA.md`](docs/INSTALACION_TIENDA.md). Resumen:

- **Entornos**: `main` se despliega automáticamente al demo
  (`demo.ammapet.cl`). Cada tienda cliente tiene su rama `tienda/<nombre>`,
  su proyecto de Vercel (*Production Branch* = esa rama), su proyecto de
  Supabase y su aplicación de Clerk. Las novedades de `main` bajan a una
  tienda solo por PR manual.
- **Clerk**: el session token debe incluir
  `{ "publicMetadata": "{{user.public_metadata}}" }`; webhook a
  `/api/webhooks/clerk` con `user.created`, `user.updated`, `user.deleted`,
  `session.created`, `session.ended`, `session.removed`.
- **Supabase**: base nueva a partir de un dump del esquema del demo (no de
  `migrations/`).
- **Vercel**: framework Next.js, build `npm run build`, raíz del repo (sin
  Root Directory).

---

## 🧪 Testing

```bash
# Ejecutar tests
npm test

# Coverage report
npm run test:coverage
```

Tests en `tests/` cubriendo:
- APIs (endpoints)
- Autenticación y permisos
- Lógica de negocio

---

## 📚 Documentación Interna

- **`CLAUDE.md`** — Instrucciones arquitectónicas para desarrollo
- **`docs/`** — Documentación técnica detallada
- **`migrations/`** — Scripts SQL para base de datos

---

## 🤝 Convenciones de Código

- **Commits**: Semantic versioning (`feat:`, `fix:`, `refactor:`, etc.)
- **Branches**: `main` (demo, deploy automático), `feat/*` para nuevas features, `tienda/<nombre>` por tienda cliente
- **TypeScript**: Tipos explícitos en todas las interfaces públicas
- **Componentes**: Modular, reutilizable, props tipadas
- **Naming**: camelCase (variables/funciones), PascalCase (componentes)

---

## 🐛 Troubleshooting

### "Unauthorized" en `/admin`
- Verifica que estés logueado con un usuario que tenga `systemAdmin` o `storeAdmin`
- En Clerk Dashboard, edita el usuario → Public metadata → `{ "systemAdmin": true }`
- Verifica que el session token incluya `publicMetadata` (ver Configuración)

### Variables de entorno no cargan
- Reinicia el servidor: `npm run dev`
- Verifica que `.env.local` esté en la raíz del repo

### Webhook de Clerk no funciona
- En producción: Verifica que la URL es `https://<dominio>/api/webhooks/clerk`
- Asegúrate que el CLERK_WEBHOOK_SECRET coincide en Clerk Dashboard

### Base de datos desincronizada
- Compara las migraciones nuevas de `migrations/` con las aplicadas en el
  proyecto (Supabase → Database → Migrations) y aplica las faltantes en orden
- Verifica que SUPABASE_SERVICE_ROLE_KEY es correcto (no ANON_KEY)

---

## 📞 Support

Para reportar bugs o sugerencias, abre un issue en GitHub o contacta al equipo de desarrollo.

---

**Última actualización**: Octubre 2026
