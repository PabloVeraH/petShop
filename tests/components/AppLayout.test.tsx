/**
 * Tests AL-01 a AL-04: AppLayout — nav por rol y banner de acceso denegado
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockReplace = jest.fn();
let mockPathname  = "/pos";
let mockSearchParamsMap: Record<string, string> = {};

jest.mock("next/navigation", () => ({
  usePathname:     () => mockPathname,
  useSearchParams: () => ({ get: (k: string) => mockSearchParamsMap[k] ?? null }),
  useRouter:       () => ({ replace: mockReplace }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, className, onClick }: any) => (
    <a href={href} className={className} onClick={onClick}>{children}</a>
  ),
}));

jest.mock("@clerk/nextjs", () => ({
  UserButton:  () => <div data-testid="user-button" />,
  useAuth:     jest.fn(),
}));

jest.mock("@/components/LicenseProvider", () => ({
  LicenseProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ name: "PetShop Test" }),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function buildMeta(role: "systemAdmin" | "storeAdmin" | "storeWorker") {
  if (role === "systemAdmin") return { systemAdmin: true };
  if (role === "storeAdmin")  return { storeAdmin: true };
  return { storeWorker: true };
}

// ── Import después de mocks ───────────────────────────────────────────────────

import AppLayout from "@/app/(app)/layout";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AppLayout — navegación por rol", () => {
  const { useAuth } = require("@clerk/nextjs");

  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = "/pos";
    mockSearchParamsMap = {};
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ name: "PetShop Test" }),
    });
  });

  // AL-01: storeWorker ve "Clientes" y "Analitica" en el nav (ampliado por decisión de negocio)
  it("AL-01: storeWorker ve POS, Clientes y Analitica en el menu", () => {
    useAuth.mockReturnValue({ sessionClaims: { publicMetadata: buildMeta("storeWorker") } });

    render(
      <AppLayout>
        <div>Contenido</div>
      </AppLayout>,
      { wrapper: makeWrapper() }
    );

    expect(screen.getByText("POS")).toBeInTheDocument();
    expect(screen.getByText("Clientes")).toBeInTheDocument();
    expect(screen.getByText("Analitica")).toBeInTheDocument();
  });

  // AL-02: storeWorker NO ve rutas de administración
  it("AL-02: storeWorker no ve Inventario, Ventas ni Configuración", () => {
    useAuth.mockReturnValue({ sessionClaims: { publicMetadata: buildMeta("storeWorker") } });

    render(
      <AppLayout>
        <div>Contenido</div>
      </AppLayout>,
      { wrapper: makeWrapper() }
    );

    expect(screen.queryByText("Inventario")).not.toBeInTheDocument();
    expect(screen.queryByText("Ventas")).not.toBeInTheDocument();
    expect(screen.queryByText("Configuración")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  // AL-03: storeAdmin ve todos los módulos excepto Admin
  it("AL-03: storeAdmin ve los módulos principales sin acceso a Admin", () => {
    useAuth.mockReturnValue({ sessionClaims: { publicMetadata: buildMeta("storeAdmin") } });

    render(
      <AppLayout>
        <div>Contenido</div>
      </AppLayout>,
      { wrapper: makeWrapper() }
    );

    expect(screen.getByText("POS")).toBeInTheDocument();
    expect(screen.getByText("Clientes")).toBeInTheDocument();
    expect(screen.getByText("Inventario")).toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });
});

// AL-04: REGRESIÓN — el layout ya NO muestra banner de acceso denegado.
// El acceso denegado ahora se gestiona con una página dedicada (/acceso-denegado).
// El middleware redirige a esa página; el layout se mantiene limpio.
describe("AppLayout — sin banner de acceso denegado (AL-04)", () => {
  const { useAuth } = require("@clerk/nextjs");

  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = "/pos";
    mockSearchParamsMap = {};
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ name: "PetShop Test" }),
    });
    useAuth.mockReturnValue({ sessionClaims: { publicMetadata: buildMeta("storeWorker") } });
  });

  it("AL-04: el layout no renderiza ningún banner de alerta, con o sin params en URL", () => {
    render(
      <AppLayout>
        <div>POS content</div>
      </AppLayout>,
      { wrapper: makeWrapper() }
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
