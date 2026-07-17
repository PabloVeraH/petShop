/**
 * Test C-42: SettingsPage — sección WhatsApp no debe exponer sus campos al
 * autocompletado de credenciales guardadas del navegador (otro contexto).
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

jest.mock("@clerk/nextjs", () => ({
  useAuth: jest.fn(() => ({
    userId: "admin-1",
    sessionClaims: { publicMetadata: { storeAdmin: true, storeId: "store-1" } },
  })),
}));

jest.mock("@/components/StoreLocationPicker", () => ({
  __esModule: true,
  default: () => null,
}));

const SETTINGS_BASE = {
  id: "store-1",
  name: "PetShop Test",
  rut: "76.123.456-7",
  address: "Calle Falsa 123",
  phone: "+56912345678",
  email: "tienda@test.com",
  whatsapp_enabled: false,
  whatsapp_phone_number_id: "",
  whatsapp_access_token: "",
  whatsapp_webhook_verify_token: "",
  email_reminder_enabled: false,
  email_reminder_dias_aviso: 5,
  resend_from_email: "",
  fidelizacion_niveles: [],
  license_start_date: null,
  license_end_date: null,
  license_warning_days: 7,
  ciudad: "",
  lat: null,
  lon: null,
  direccion: null,
};

global.fetch = jest.fn().mockImplementation(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(SETTINGS_BASE) })
);

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

async function renderPage() {
  const SettingsPage = (await import("@/app/(app)/settings/page")).default;
  return render(React.createElement(SettingsPage), { wrapper: makeWrapper() });
}

describe("SettingsPage — WhatsApp autoComplete (C-42)", () => {
  beforeEach(() => jest.clearAllMocks());

  // C-42 — REGRESIÓN: sin autoComplete, el navegador ofrecía autocompletar
  // Access Token de WhatsApp con credenciales guardadas de otro contexto.
  it("C-42: REGRESIÓN — Access Token tiene autoComplete=\"new-password\"; Phone Number ID y Verify Token tienen autoComplete=\"off\"", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Access Token")).toBeInTheDocument();
    });

    const phoneNumberId = screen.getByPlaceholderText("123456789012345");
    const accessToken = screen.getByPlaceholderText("EAAxxxx...");
    const verifyToken = screen.getByPlaceholderText("mi-token-secreto-123");

    expect(accessToken).toHaveAttribute("type", "password");
    expect(accessToken).toHaveAttribute("autocomplete", "new-password");
    expect(phoneNumberId).toHaveAttribute("autocomplete", "off");
    expect(verifyToken).toHaveAttribute("autocomplete", "off");
  });
});
