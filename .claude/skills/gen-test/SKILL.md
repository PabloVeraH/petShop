---
name: "gen-test"
description: "Genera tests para petShop siguiendo TDD London School (mock-first). Crea tests unitarios en tests/unit/lib/ o tests/unit/components/, tests de integración en tests/integration/api/, o tests de componentes en tests/components/. Usa el patrón del proyecto: jest.fn() para mocks, describe anidados, nomenclatura U-XX/I-XX/C-XX. Úsalo cuando necesites generar tests para una función lib, API route, o componente React del proyecto."
---

# gen-test

## Qué hace

Genera tests para el proyecto petShop siguiendo exactamente los patrones existentes:
- **TDD London School**: mocks primero, comportamiento sobre implementación
- **Nomenclatura**: `U-XX` (unit), `I-XX` (integration), `C-XX` (component)
- **Ubicación correcta** según el tipo de código a testear

## Uso rápido

```
/gen-test src/lib/hub-sync.ts
/gen-test src/app/api/productos/route.ts
/gen-test src/components/pos/CartItem.tsx
```

---

## Reglas del proyecto

### Estructura de carpetas

| Tipo | Carpeta | Prefijo ID |
|------|---------|-----------|
| Funciones lib | `tests/unit/lib/` | `U-XX` |
| Componentes React | `tests/unit/components/` o `tests/components/` | `C-XX` |
| API routes | `tests/integration/api/` | `I-XX` |

### Patrón unit test (lib)

```typescript
// tests/unit/lib/mi-modulo.test.ts
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockResolvedValue({ data: [], error: null }),
};

jest.mock("@/lib/supabase", () => ({ createClient: () => mockSupabase }));

describe("lib/mi-modulo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("U-XX: descripción del comportamiento esperado", async () => {
    // Arrange
    mockSupabase.eq.mockResolvedValueOnce({ data: [{ id: "1" }], error: null });

    // Act
    const result = await miFuncion("arg");

    // Assert
    expect(result).toEqual(expect.objectContaining({ id: "1" }));
  });
});
```

### Patrón integration test (API route)

```typescript
// tests/integration/api/mi-ruta.test.ts
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/mi-ruta/route";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({
    userId: "user_test",
    sessionClaims: { publicMetadata: { role: "storeAdmin", storeId: "store-uuid" } },
  }),
}));

jest.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockResolvedValue({ data: [], error: null }),
  }),
}));

describe("POST /api/mi-ruta", () => {
  it("I-XX: retorna 200 con datos válidos", async () => {
    const req = new NextRequest("http://localhost/api/mi-ruta", {
      method: "POST",
      body: JSON.stringify({ campo: "valor" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveProperty("data");
  });

  it("I-XX: retorna 401 sin autenticación", async () => {
    const { auth } = require("@clerk/nextjs/server");
    auth.mockResolvedValueOnce({ userId: null });

    const req = new NextRequest("http://localhost/api/mi-ruta", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
```

### Patrón component test (React)

```typescript
// tests/components/MiComponente.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MiComponente from "@/components/MiComponente";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
);

describe("MiComponente", () => {
  it("C-XX: muestra el contenido esperado", () => {
    render(<MiComponente prop="valor" />, { wrapper });
    expect(screen.getByText("contenido")).toBeInTheDocument();
  });
});
```

---

## Procedimiento

1. **Leer el archivo** a testear con Read tool
2. **Identificar el tipo**: lib function, API route, o React component
3. **Determinar la carpeta** y el prefijo de ID correcto
4. **Revisar tests existentes** en la carpeta destino para tomar el número de ID siguiente (grep `U-\d+` o `I-\d+`)
5. **Crear el archivo** de test con el patrón correspondiente
6. **Ejecutar** `npm test -- --testPathPattern=nombre-del-test` para verificar

## Mocks críticos del proyecto

```typescript
// Clerk auth - usuario autenticado como storeAdmin
jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn().mockResolvedValue({
    userId: "user_clerk_test",
    sessionClaims: {
      publicMetadata: { role: "storeAdmin", storeId: "store-uuid-test" }
    },
  }),
}));

// Supabase client
jest.mock("@/lib/supabase", () => ({
  createClient: jest.fn(() => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockResolvedValue({ data: null, error: null }),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  })),
}));

// logAudit (fire-and-forget, no testear internos)
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

// crearAsiento (fire-and-forget)
jest.mock("@/lib/contabilidad/generador-asientos", () => ({
  crearAsiento: jest.fn(),
}));

// syncProductsToHub (fire-and-forget)
jest.mock("@/lib/hub-sync", () => ({
  syncProductsToHub: jest.fn(),
  syncPurchaseToHub: jest.fn(),
}));
```

## Reglas obligatorias

- SIEMPRE leer el archivo fuente antes de generar el test
- NO testear detalles de implementación — testear comportamiento observable
- Los tests de API routes deben cubrir: éxito, sin auth (401), sin permisos (403), input inválido (400)
- Usar `store_id` en todos los fixtures — multi-tenancy es crítico
- Después de crear el test: ejecutar `npm test -- --testPathPattern=<archivo>` para confirmar que pasa
