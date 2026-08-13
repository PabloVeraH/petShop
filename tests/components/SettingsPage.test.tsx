/**
 * Tests C-45 a C-49: SettingsPage — sección de Licencia
 *
 * C-45  Sección Licencia visible con fecha de inicio, término y estado
 * C-46  Sin fechas configuradas muestra "Sin configurar"
 * C-47  Licencia vencida muestra "VENCIDA"
 * C-48  systemAdmin ve enlace a /admin para gestionar
 * C-49  storeAdmin NO ve enlace a /admin
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

let mockUseAuth: { userId: string; sessionClaims: { publicMetadata: Record<string, unknown> } } = {
  userId: "admin-1",
  sessionClaims: { publicMetadata: { storeAdmin: true, storeId: "store-1" } },
};

jest.mock("@clerk/nextjs", () => ({
  useAuth: jest.fn(() => mockUseAuth),
}));

jest.mock("@/components/StoreLocationPicker", () => ({
  __esModule: true,
  default: () => null,
}));

beforeAll(() => {
  (global as Record<string, unknown>).fetch = jest.fn();
});

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split("T")[0];
}

function pastDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

async function renderPage(fetchData: object) {
  (global.fetch as jest.Mock).mockImplementation(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(fetchData) })
  );
  const SettingsPage = (await import("@/app/(app)/settings/page")).default;
  return render(React.createElement(SettingsPage), { wrapper: makeWrapper() });
}

describe("SettingsPage — Licencia section", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // C-45: license section renders with dates
  it("C-45: sección Licencia visible con fechas y estado Activa", async () => {
    mockUseAuth = {
      userId: "admin-1",
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: "store-1" } },
    };
    const start = futureDate(-30);
    const end = futureDate(180);
    await renderPage({
      id: "store-1",
      name: "PetShop Test",
      rut: "76.123.456-7",
      address: "Calle Falsa 123",
      phone: "+56912345678",
      email: "tienda@test.com",
      whatsapp_enabled: false,
      whatsapp_access_token: "",
      whatsapp_webhook_verify_token: "",
      email_reminder_enabled: false,
      email_reminder_dias_aviso: 5,
      resend_from_email: "",
      fidelizacion_niveles: [],
      license_start_date: start,
      license_end_date: end,
      license_warning_days: 30,
      ciudad: "",
      lat: null,
      lon: null,
      direccion: null,
    });

    await waitFor(() => {
      expect(screen.getByText("Licencia")).toBeInTheDocument();
    });

    // "Activa" appears in the badge AND in the Estado field
    expect(screen.getAllByText("Activa").length).toBeGreaterThanOrEqual(2);
    // C-45 (corregido): la fecha se formatea SIN desfase de zona horaria —
    // se parsea la cadena "YYYY-MM-DD" como medianoche local, no como UTC
    expect(screen.getByText(new Date(start + "T00:00:00").toLocaleDateString("es-CL"))).toBeInTheDocument();
    expect(screen.getByText(new Date(end + "T00:00:00").toLocaleDateString("es-CL"))).toBeInTheDocument();
  });

  // C-46: no license dates
  it("C-46: sin fechas configuradas muestra Sin configurar", async () => {
    mockUseAuth = {
      userId: "admin-1",
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: "store-1" } },
    };
    await renderPage({
      id: "store-1",
      name: "PetShop Test",
      whatsapp_access_token: "",
      license_start_date: null,
      license_end_date: null,
      license_warning_days: 7,
      fidelizacion_niveles: [],
      ciudad: "",
      lat: null,
      lon: null,
      direccion: null,
    });

    await waitFor(() => {
      expect(screen.getByText("Licencia")).toBeInTheDocument();
    });

    // "Sin configurar" appears in the badge AND in the Estado field
    expect(screen.getAllByText("Sin configurar").length).toBeGreaterThanOrEqual(2);
  });

  // C-47: expired license
  it("C-47: licencia vencida muestra VENCIDA", async () => {
    mockUseAuth = {
      userId: "admin-1",
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: "store-1" } },
    };
    await renderPage({
      id: "store-1",
      name: "PetShop Test",
      whatsapp_access_token: "",
      license_start_date: pastDate(400),
      license_end_date: pastDate(10),
      license_warning_days: 30,
      fidelizacion_niveles: [],
      ciudad: "",
      lat: null,
      lon: null,
      direccion: null,
    });

    await waitFor(() => {
      expect(screen.getByText("Licencia")).toBeInTheDocument();
    });

    // "VENCIDA" appears in the badge AND in the Estado field
    expect(screen.getAllByText("VENCIDA").length).toBeGreaterThanOrEqual(2);
  });

  // C-48: systemAdmin sees link to /admin
  it("C-48: systemAdmin ve enlace a Administración para gestionar licencia", async () => {
    mockUseAuth = {
      userId: "admin-1",
      sessionClaims: { publicMetadata: { systemAdmin: true, storeId: "store-1" } },
    };
    const end = futureDate(180);
    await renderPage({
      id: "store-1",
      name: "PetShop Test",
      whatsapp_access_token: "",
      license_start_date: futureDate(-30),
      license_end_date: end,
      license_warning_days: 30,
      fidelizacion_niveles: [],
      ciudad: "",
      lat: null,
      lon: null,
      direccion: null,
    });

    await waitFor(() => {
      expect(screen.getByText("Licencia")).toBeInTheDocument();
    });

    const adminLink = screen.getByText(/Ir a Administración/i);
    expect(adminLink).toBeInTheDocument();
    expect(adminLink.closest("a")).toHaveAttribute("href", "/admin");
  });

  // C-49: storeAdmin does NOT see link to /admin
  it("C-49: storeAdmin NO ve enlace a /admin", async () => {
    mockUseAuth = {
      userId: "admin-2",
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: "store-1" } },
    };
    const end = futureDate(180);
    await renderPage({
      id: "store-1",
      name: "PetShop Test",
      whatsapp_access_token: "",
      license_start_date: futureDate(-30),
      license_end_date: end,
      license_warning_days: 30,
      fidelizacion_niveles: [],
      ciudad: "",
      lat: null,
      lon: null,
      direccion: null,
    });

    await waitFor(() => {
      expect(screen.getByText("Licencia")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Ir a Administración/i)).not.toBeInTheDocument();
  });

  // C-60: REGRESIÓN (ticket Trello 6a77ef3a0ed45ac54505c62a) — las fechas de
  // licencia se muestran iguales a las almacenadas (columna DATE "YYYY-MM-DD").
  // Valores reales del repro en producción: inicio 2026-05-01, término
  // 2026-12-31. Antes del fix, new Date("2026-05-01") se parseaba como UTC y en
  // América/Santiago la pantalla mostraba 30-04-2026 / 30-12-2026 (1 día antes
  // que Admin > Licencia). Con el fix ambas vistas muestran 01-05-2026 y
  // 31-12-2026, sin importar el huso del navegador (la comparación aquí es
  // contra el texto renderizado, no contra un Date).
  it("C-60: fechas de licencia sin desfase de 1 día (iguales a las almacenadas)", async () => {
    mockUseAuth = {
      userId: "admin-1",
      sessionClaims: { publicMetadata: { storeAdmin: true, storeId: "store-1" } },
    };
    await renderPage({
      id: "store-1",
      name: "PetShop Test",
      whatsapp_access_token: "",
      license_start_date: "2026-05-01",
      license_end_date: "2026-12-31",
      license_warning_days: 3,
      fidelizacion_niveles: [],
      ciudad: "",
      lat: null,
      lon: null,
      direccion: null,
    });

    await waitFor(() => {
      expect(screen.getByText("Licencia")).toBeInTheDocument();
    });

    // Mismas fechas que muestra Admin > Licencia, sin el día de desfase.
    expect(screen.getByText("01-05-2026")).toBeInTheDocument();
    expect(screen.getByText("31-12-2026")).toBeInTheDocument();
    expect(screen.queryByText("30-04-2026")).not.toBeInTheDocument();
    expect(screen.queryByText("30-12-2026")).not.toBeInTheDocument();
  });
});
