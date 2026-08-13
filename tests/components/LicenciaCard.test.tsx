/**
 * Tests C-61 a C-64: LicenciaCard (Admin > Licencia)
 *
 * C-61 RESGRACIÓN — "El banner de aviso aparecerá ..." se calcula sobre la
 *      fecha almacenada sin desfase de zona horaria (fin 2026-05-01 con 7 días
 *      de aviso → 24-04-2026, no 23-04-2026)
 * C-62  Los inputs Fecha de inicio/término muestran el valor almacenado
 *      (YYYY-MM-DD), consistente con la vista de Configuración
 * C-63  Estado VENCIDA cuando status.isAutoBlocked
 * C-64  Estado "Sin configurar" sin fecha de término
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { LicenciaCard } from "@/components/admin/LicenciaCard";

jest.mock("@clerk/nextjs", () => ({
  useAuth: jest.fn(),
}));

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

async function renderLicencia(config: {
  license_start_date: string | null;
  license_end_date: string | null;
  license_warning_days: number;
}, status: { isAutoBlocked: boolean; isInWarningPeriod: boolean; daysUntilExpiry: number | null; licenseEndDate: string | null }) {
  (global as Record<string, unknown>).fetch = jest.fn((url: string) => {
    if (url.includes("/api/admin/license/users")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          config,
          status,
        }),
    });
  }) as unknown as typeof fetch;
  return render(<LicenciaCard />, { wrapper: makeWrapper() });
}

describe("LicenciaCard — fechas y período de licencia", () => {
  // C-61: REGRESIÓN (ticket Trello 6a77ef3a0ed45ac54505c62a) — el preview del
  // banner "El banner de aviso aparecerá ..." restaba días a la fecha de
  // término parseada con new Date("YYYY-MM-DD") = medianoche UTC; en
  // América/Santiago la fecha quedaba 1 día antes (23-04-2026 en vez de
  // 24-04-2026). Mismo desfase que el reportado en la pantalla.
  it("C-61: preview del banner usa la fecha almacenada sin desfase (fin 2026-05-01 − 7d = 24-04-2026)", async () => {
    await renderLicencia(
      { license_start_date: "2026-05-01", license_end_date: "2026-05-01", license_warning_days: 7 },
      { isAutoBlocked: false, isInWarningPeriod: true, daysUntilExpiry: 0, licenseEndDate: "2026-05-01" }
    );

    await waitFor(() => {
      expect(screen.getByText("Período de Licencia")).toBeInTheDocument();
    }, { timeout: 3000 });

    const banner = screen.getByText(/El banner de aviso aparecerá/);
    expect(banner.textContent).toContain("24-04-2026");
    expect(banner.textContent).not.toContain("23-04-2026");
  });

  // C-62: los inputs muestran el valor almacenado tal cual (YYYY-MM-DD) — la
  // misma cadena que Configuración ahora formatea sin desfase, por lo que
  // ambas vistas quedan consistentes.
  it("C-62: inputs de fecha muestran el valor almacenado (2026-05-01 y 2026-12-31)", async () => {
    await renderLicencia(
      { license_start_date: "2026-05-01", license_end_date: "2026-12-31", license_warning_days: 7 },
      { isAutoBlocked: false, isInWarningPeriod: false, daysUntilExpiry: 140, licenseEndDate: "2026-12-31" }
    );

    await waitFor(() => {
      expect(screen.getByText("Período de Licencia")).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByDisplayValue("2026-05-01")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-12-31")).toBeInTheDocument();
  });

  // C-63: estado VENCIDA
  it("C-63: status.isAutoBlocked → muestra VENCIDA", async () => {
    await renderLicencia(
      { license_start_date: "2026-01-01", license_end_date: "2026-05-01", license_warning_days: 7 },
      { isAutoBlocked: true, isInWarningPeriod: false, daysUntilExpiry: null, licenseEndDate: "2026-05-01" }
    );

    await waitFor(() => {
      expect(screen.getByText("VENCIDA")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  // C-64: sin fecha de término → "Sin configurar"
  it("C-64: sin license_end_date → muestra Sin configurar", async () => {
    await renderLicencia(
      { license_start_date: null, license_end_date: null, license_warning_days: 7 },
      { isAutoBlocked: false, isInWarningPeriod: false, daysUntilExpiry: null, licenseEndDate: null }
    );

    await waitFor(() => {
      expect(screen.getByText("Sin configurar")).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});