/**
 * Tests AP-01 a AP-04: AdminPage — redirect por rol
 *
 * AP-01 storeAdmin es redirigido a /pos (no debe acceder a /admin)
 * AP-02 systemAdmin NO es redirigido (puede acceder a /admin)
 * AP-03 storeWorker es redirigido a /pos
 * AP-04 systemAdmin con JWT stale (API stores devuelve 403) → redirigido a /pos
 */
import "@testing-library/jest-dom";
import { render, waitFor } from "@testing-library/react";
import React from "react";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("@clerk/nextjs", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="admin-layout">{children}</div>,
}));

jest.mock("@/components/admin/ClerkDevWarning", () => ({
  ClerkDevWarning: () => null,
}));

jest.mock("@/components/admin/UsuariosCard", () => ({
  UsuariosCard: () => null,
}));

jest.mock("@/components/admin/LicenciaCard", () => ({
  LicenciaCard: () => null,
}));

jest.mock("@/components/admin/AuditoriaCard", () => ({
  AuditoriaCard: () => null,
}));

jest.mock("@/components/admin/IAConfigSection", () => ({
  IAConfigSection: () => null,
}));

// Mock useQuery to return immediate data — avoids loading state when query is enabled
const mockUseQuery = jest.fn().mockReturnValue({ data: [], isLoading: false });
jest.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

function buildMeta(role: "systemAdmin" | "storeAdmin" | "storeWorker") {
  if (role === "systemAdmin") return { systemAdmin: true, storeId: "store-1" };
  if (role === "storeAdmin") return { storeAdmin: true, storeId: "store-1" };
  return { storeWorker: true };
}

async function renderPage(role: "systemAdmin" | "storeAdmin" | "storeWorker") {
  const clerkMod = await import("@clerk/nextjs");
  clerkMod.useAuth.mockReturnValue({
    userId: "user-1",
    sessionClaims: { publicMetadata: buildMeta(role) },
  });

  // For systemAdmin, the query is enabled — return data synchronously
  if (role === "systemAdmin") {
    mockUseQuery.mockReturnValue({
      data: [{ id: "store-1", name: "Store", rut: null, email: null, phone: null, created_at: "2024-01-01", whatsapp_enabled: false, license_start_date: null, license_end_date: null, license_warning_days: 7, openrouter_model: null }],
      isLoading: false,
    });
  } else {
    // For storeAdmin/storeWorker, query is disabled — return empty, not loading
    mockUseQuery.mockReturnValue({ data: [], isLoading: false });
  }

  const AdminPage = (await import("@/app/(app)/admin/page")).default;
  return render(React.createElement(AdminPage));
}

describe("AdminPage — redirect por rol", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("AP-01: storeAdmin redirigido a /pos (no debe acceder a /admin)", async () => {
    await renderPage("storeAdmin");
    expect(mockReplace).toHaveBeenCalledWith("/pos");
  });

  it("AP-02: systemAdmin NO es redirigido (puede acceder a /admin)", async () => {
    const { container } = await renderPage("systemAdmin");
    await waitFor(() => {
      expect(container.querySelector('[data-testid="admin-layout"]')).toBeInTheDocument();
    }, { timeout: 5000 });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("AP-03: storeWorker redirigido a /pos", async () => {
    await renderPage("storeWorker");
    expect(mockReplace).toHaveBeenCalledWith("/pos");
  });

  // AP-04: REGRESIÓN — JWT dice systemAdmin pero stores API devuelve 403
  // (DB cross-verify detecta JWT stale) → debe redirigir a /pos
  it("AP-04: JWT stale con systemAdmin pero API stores retorna error → redirige a /pos", async () => {
    const clerkMod2 = await import("@clerk/nextjs");
    clerkMod2.useAuth.mockReturnValue({
      userId: "user-1",
      sessionClaims: { publicMetadata: buildMeta("systemAdmin") },
    });

    // Simula stores API devolviendo 403 (DB cross-verify rechaza)
    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
    });

    const AdminPage = (await import("@/app/(app)/admin/page")).default;
    render(React.createElement(AdminPage));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/pos");
    }, { timeout: 5000 });
  });
});
