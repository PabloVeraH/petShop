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

describe("AppLayout — banner de acceso denegado (AL-04/AL-05)", () => {
  const { useAuth } = require("@clerk/nextjs");

  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = "/pos";
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ name: "PetShop Test" }),
    });
    useAuth.mockReturnValue({ sessionClaims: { publicMetadata: buildMeta("storeWorker") } });
  });

  // AL-04: REGRESIÓN — cuando el middleware redirige con _denied=<path>, se muestra el banner
  // con el nombre de la sección bloqueada (no "esa sección" genérico).
  it("AL-04: muestra banner con nombre de sección cuando URL contiene _denied=<path>", async () => {
    // El middleware envía la ruta bloqueada; el layout la decodifica y busca el label en navItems
    mockSearchParamsMap = { _denied: "/inventory" };

    render(
      <AppLayout>
        <div>POS content</div>
      </AppLayout>,
      { wrapper: makeWrapper() }
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument()
    );
    // "/inventory" mapea al navItem { label: "Inventario" }
    expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso para acceder a Inventario");
  });

  // AL-05: la URL se limpia y router.replace es llamado al mostrar el banner
  it("AL-05: router.replace es llamado con pathname limpio sin _denied al mostrar el banner", async () => {
    mockSearchParamsMap = { _denied: "/inventory" };

    render(
      <AppLayout>
        <div>POS content</div>
      </AppLayout>,
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    // Debe llamar replace con la ruta limpia, sin el param
    expect(mockReplace).toHaveBeenCalledWith("/pos", { scroll: false });
  });

  // AL-06: sin _denied en URL, no se muestra ningún banner
  it("AL-06: sin _denied no aparece banner de acceso denegado", () => {
    mockSearchParamsMap = {};

    render(
      <AppLayout>
        <div>POS content</div>
      </AppLayout>,
      { wrapper: makeWrapper() }
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
