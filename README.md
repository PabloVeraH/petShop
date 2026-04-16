# petShop — Sistema de Gestión para Tiendas de Mascotas

Sistema integral de gestión para tiendas de mascotas con autenticación, punto de venta, inventario, usuarios y reportes.

**Tech Stack**: Next.js 16 • React 19 • TypeScript • Tailwind CSS • Clerk • Supabase • tanstack-query

---

## 🚀 Inicio Rápido

### Requisitos
- **Node.js** ≥ 18
- **npm** o **yarn**
- **Clerk** (autenticación) — [obtener credenciales](https://dashboard.clerk.com)
- **Supabase** (base de datos) — [crear proyecto](https://app.supabase.com)

### Instalación Local

```bash
cd app
npm install
```

### Variables de Entorno

Copia `.env.example` a `.env.local` y completa:

```bash
cp .env.example .env.local
```

**Variables necesarias:**
```env
# Clerk (obtener en dashboard.clerk.com)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/auth/login
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/auth/signup
CLERK_WEBHOOK_SECRET=whsec_...

# Supabase (obtener en app.supabase.com → Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Integración Hub (opcional)
HUB_URL=http://tu_url
HUB_SYNC_SECRET=store-...
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
app/
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
├── package.json
├── tsconfig.json
└── tailwind.config.ts
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

Ver `migrations/` para schema completo.

---

## 🔑 Variables & Configuración

### Clerk Setup
1. Ve a [dashboard.clerk.com](https://dashboard.clerk.com)
2. Crea una aplicación
3. En **API Keys**, copia:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
4. En **Webhooks**, crea uno para `user.created` y `user.updated` → `POST /api/webhooks/clerk`

### Supabase Setup
1. Ve a [app.supabase.com](https://app.supabase.com)
2. Crea un proyecto
3. En **Settings → API**, copia:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Ejecuta migraciones: `psql -h ... < migrations/schema.sql`

---

## 📦 Despliegue en Vercel

### 1. Conectar Repositorio
```bash
# Push a GitHub/GitLab
git push origin develop
```

Ve a [vercel.com](https://vercel.com) → New Project → Importa tu repo

### 2. Configurar Variables de Entorno
En Vercel Dashboard → Settings → Environment Variables, agrega:
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
NEXT_PUBLIC_CLERK_SIGN_IN_URL
NEXT_PUBLIC_CLERK_SIGN_UP_URL
CLERK_WEBHOOK_SECRET
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
HUB_URL (opcional)
HUB_SYNC_SECRET (opcional)
```

### 3. Build Settings
- **Framework**: Next.js
- **Build Command**: `npm run build`
- **Output Directory**: `.next`
- **Root Directory**: `app/`

### 4. Desplegar
Vercel detecta automáticamente cambios en `develop` y despliega.

**URL de producción**: `https://your-app.vercel.app`

### 5. Actualizar Webhooks
En Clerk Dashboard → Webhooks, actualiza la URL de webhook:
```
https://your-app.vercel.app/api/webhooks/clerk
```

---

## 🧪 Testing

```bash
# Ejecutar tests
npm test

# Coverage report
npm test:coverage
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
- **Branches**: `develop` (main), feature branches para nuevas features
- **TypeScript**: Tipos explícitos en todas las interfaces públicas
- **Componentes**: Modular, reutilizable, props tipadas
- **Naming**: camelCase (variables/funciones), PascalCase (componentes)

---

## 🐛 Troubleshooting

### "Unauthorized" en `/admin`
- Verifica que estés logueado con un usuario que tenga `systemAdmin` o `storeAdmin`
- En Clerk Dashboard, edita el usuario → Custom Attributes → set `systemAdmin: true`

### Variables de entorno no cargan
- Reinicia el servidor: `npm run dev`
- Verifica que `.env.local` esté en `app/.env.local` (no en raíz)

### Webhook de Clerk no funciona
- En producción: Verifica que la URL es `https://your-app.vercel.app/api/webhooks/clerk`
- Asegúrate que el CLERK_WEBHOOK_SECRET coincide en Clerk Dashboard

### Base de datos desincronizada
- Ejecuta migraciones: `psql -h ... < migrations/schema.sql`
- Verifica que SUPABASE_SERVICE_ROLE_KEY es correcto (no ANON_KEY)

---

## 📞 Support

Para reportar bugs o sugerencias, abre un issue en GitHub o contacta al equipo de desarrollo.

---

**Última actualización**: Abril 2026
