/**
 * Tests CC-01 a CC-05: Canal config page — activo toggle en POST
 *
 * CC-01: Guardar sin tocar el toggle → envía activo=false
 * CC-02: Guardar sin credenciales → canal queda inactivo (no se activa automáticamente)
 * CC-03: POST retorna activo=true → frontend sincroniza a true
 * CC-04: Activar toggle sin credenciales → muestra error, no envía request
 * CC-05: Activar toggle con credencial de solo espacios → muestra error, no envía request
 * CC-06: Activar toggle con solo 1 de 4 campos → muestra error, no envía request
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock next/navigation
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ canal: "rappi" }),
}));

let fetchCalls: Array<{ url: string; options?: RequestInit }> = [];

async function renderPage() {
  const CanalConfigPage = (await import("@/app/(app)/canales/[canal]/page")).default;
  return render(React.createElement(CanalConfigPage));
}

describe("CanalConfigPage — activo handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchCalls = [];
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      fetchCalls.push({ url, options });
      if (options?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "cfg-1", canal_id: "rappi", activo: false }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => [],
      });
    });
  });

  // CC-01
  it("CC-01: POST sin tocar toggle → envía activo=false en body", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });

    // Completar campo de credencial pero dejar toggle como está (inactivo por defecto)
    const inputs = screen.getAllByPlaceholderText(/rk_live|ws_rappi|12345|whsec/);
    fireEvent.change(inputs[0], { target: { value: "rk_test_123" } });

    // Click "Guardar configuración"
    fireEvent.click(screen.getByText("Guardar configuración"));

    await waitFor(() => {
      const postCall = fetchCalls.find((c) => c.options?.method === "POST");
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall!.options!.body as string);
      expect(body.activo).toBe(false);
    });
  });

  // CC-02
  it("CC-02: POST sin credenciales → canal queda inactivo (no se activa por arte de magia)", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });

    // No llenar ningún campo de credencial
    // Click "Guardar configuración"
    fireEvent.click(screen.getByText("Guardar configuración"));

    await waitFor(() => {
      const postCall = fetchCalls.find((c) => c.options?.method === "POST");
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall!.options!.body as string);
      expect(body.activo).toBe(false);
    });

    // Después de guardar, el estado en UI debe ser Inactivo
    await waitFor(() => {
      expect(screen.getByText("Inactivo")).toBeInTheDocument();
    });
  });

  // CC-03
  it("CC-03: POST retorna activo=true → frontend sincroniza a true", async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      fetchCalls.push({ url, options });
      if (options?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "cfg-1", canal_id: "rappi", activo: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => [],
      });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });

    // Llenar TODAS las credenciales (Rappi requiere 4 campos)
    const inputs = screen.getAllByPlaceholderText(/rk_live|ws_rappi|12345|whsec/);
    fireEvent.change(inputs[0], { target: { value: "rk_test_123" } });
    fireEvent.change(inputs[1], { target: { value: "ws_rappi_secret" } });
    fireEvent.change(inputs[2], { target: { value: "12345" } });
    fireEvent.change(inputs[3], { target: { value: "whsec_abc" } });

    // Activar toggle — click en el div toggle
    const toggleSwitch = document.querySelector(".bg-gray-300");
    expect(toggleSwitch).not.toBeNull();
    fireEvent.click(toggleSwitch!);

    await waitFor(() => {
      expect(screen.getByText("Activo")).toBeInTheDocument();
    });

    // Guardar
    fireEvent.click(screen.getByText("Guardar configuración"));

    await waitFor(() => {
      const postCall = fetchCalls.find((c) => c.options?.method === "POST");
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall!.options!.body as string);
      expect(body.activo).toBe(true);
    });

    // Después de guardar, sigue Activo
    await waitFor(() => {
      expect(screen.getByText("Activo")).toBeInTheDocument();
    });
  });

  // CC-04
  it("CC-04: Activar toggle sin credenciales → muestra error, no envía request", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });

    const initialFetchCount = fetchCalls.length;

    // Activar toggle sin llenar credenciales
    const toggleSwitch = document.querySelector(".bg-gray-300");
    expect(toggleSwitch).not.toBeNull();
    fireEvent.click(toggleSwitch!);

    await waitFor(() => {
      expect(screen.getByText("Activo")).toBeInTheDocument();
    });

    // Intentar guardar
    fireEvent.click(screen.getByText("Guardar configuración"));

    await waitFor(() => {
      expect(screen.getByText(/Debe completar todas las credenciales/i)).toBeInTheDocument();
    });

    // No se envió ningún fetch nuevo
    expect(fetchCalls.length).toBe(initialFetchCount);
  });

  // CC-05 — REGRESIÓN: un valor de solo espacios no debe contar como credencial
  it("CC-05: activar toggle con credencial de solo espacios en blanco → muestra error, no envía request", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });

    // Llenar un campo con solo espacios en blanco
    const inputs = screen.getAllByPlaceholderText(/rk_live|ws_rappi|12345|whsec/);
    fireEvent.change(inputs[0], { target: { value: "   " } });

    const initialFetchCount = fetchCalls.length;

    // Activar toggle
    const toggleSwitch = document.querySelector(".bg-gray-300");
    expect(toggleSwitch).not.toBeNull();
    fireEvent.click(toggleSwitch!);

    await waitFor(() => {
      expect(screen.getByText("Activo")).toBeInTheDocument();
    });

    // Intentar guardar
    fireEvent.click(screen.getByText("Guardar configuración"));

    await waitFor(() => {
      expect(screen.getByText(/Debe completar todas las credenciales/i)).toBeInTheDocument();
    });

    // No se envió ningún fetch nuevo
    expect(fetchCalls.length).toBe(initialFetchCount);
  });

  // CC-06 — Bug fix: activar con solo 1 de 4 campos muestra error, no envía request
  it("CC-06: activar toggle con solo 1 de 4 campos Rappi → muestra error, no envía request", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });

    // Llenar solo 1 de 4 campos requeridos
    const inputs = screen.getAllByPlaceholderText(/rk_live|ws_rappi|12345|whsec/);
    fireEvent.change(inputs[0], { target: { value: "rk_test_123" } });

    const initialFetchCount = fetchCalls.length;

    // Activar toggle
    const toggleSwitch = document.querySelector(".bg-gray-300");
    expect(toggleSwitch).not.toBeNull();
    fireEvent.click(toggleSwitch!);

    await waitFor(() => {
      expect(screen.getByText("Activo")).toBeInTheDocument();
    });

    // Intentar guardar
    fireEvent.click(screen.getByText("Guardar configuración"));

    await waitFor(() => {
      expect(screen.getByText(/Debe completar todas las credenciales/i)).toBeInTheDocument();
    });

    // No se envió ningún fetch nuevo
    expect(fetchCalls.length).toBe(initialFetchCount);
  });

  // CC-07 — REGRESIÓN: sin autoComplete, el navegador ofrecía autocompletar
  // API Key/Secret con credenciales guardadas de otro contexto (email/password).
  it("CC-07: REGRESIÓN — campos type=\"password\" (API Key, API Secret, Webhook Secret) tienen autoComplete=\"new-password\"", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });

    const passwordInputs = document.querySelectorAll('input[type="password"]');
    // Rappi: API Key, API Secret, Webhook Secret → 3 campos password
    expect(passwordInputs.length).toBe(3);
    passwordInputs.forEach((input) => {
      expect(input).toHaveAttribute("autocomplete", "new-password");
    });
  });

  // CC-10 — REGRESIÓN: error de credenciales debe limpiarse al desactivar el toggle
  it("CC-10: toggle a inactivo después de error → error se limpia sin necesidad de guardar", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });

    // Activar toggle sin credenciales → error
    const toggleSwitch = document.querySelector(".bg-gray-300");
    expect(toggleSwitch).not.toBeNull();
    fireEvent.click(toggleSwitch!);

    await waitFor(() => {
      expect(screen.getByText("Activo")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Guardar configuración"));

    await waitFor(() => {
      expect(screen.getByText(/Debe completar todas las credenciales/i)).toBeInTheDocument();
    });

    // Desactivar toggle → error debe desaparecer sin guardar
    const toggleActive = document.querySelector(".bg-green-500");
    expect(toggleActive).not.toBeNull();
    fireEvent.click(toggleActive!);

    await waitFor(() => {
      expect(screen.getByText("Inactivo")).toBeInTheDocument();
    });

    // El mensaje de error ya no debe estar presente
    expect(screen.queryByText(/Debe completar todas las credenciales/i)).toBeNull();
  });

  // CC-08 — mismo defecto en campos type="text" (Store ID, Client ID, etc.):
  // sin autoComplete="off", el navegador aplica heurísticas propias sobre
  // identificadores que no son datos de perfil del usuario.
  it("CC-08: campo type=\"text\" (Store ID) tiene autoComplete=\"off\"", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });

    const textInputs = document.querySelectorAll('input[type="text"]');
    // Rappi: Store ID → 1 campo text
    expect(textInputs.length).toBe(1);
    expect(textInputs[0]).toHaveAttribute("autocomplete", "off");
  });

  // CC-11 — REGRESIÓN (ticket Trello 6a5f9b146418dc26e56d7274): reactivar un
  // canal que YA tiene credenciales guardadas en el backend, sin reingresarlas
  // en el formulario (que nunca las precarga — no se desencriptan por
  // seguridad), no debe bloquearse client-side. Antes, allCredentialsFilled
  // solo miraba el estado del formulario y rechazaba la reactivación aunque
  // el backend ya tuviera las credenciales guardadas.
  it("CC-11: reactivar canal con credenciales ya guardadas y formulario vacío → no bloquea, envía el PATCH", async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      fetchCalls.push({ url, options });
      if (options?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "cfg-1", canal_id: "rappi", activo: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => [{ id: "cfg-1", canal_id: "rappi", activo: false, tiene_credenciales: true }],
      });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Inactivo")).toBeInTheDocument();
    });

    // No llenar ningún campo de credencial — reactivar directamente
    const toggleSwitch = document.querySelector(".bg-gray-300");
    expect(toggleSwitch).not.toBeNull();
    fireEvent.click(toggleSwitch!);

    await waitFor(() => {
      expect(screen.getByText("Activo")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Guardar configuración"));

    await waitFor(() => {
      const patchCall = fetchCalls.find((c) => c.options?.method === "PATCH");
      expect(patchCall).toBeDefined();
      const body = JSON.parse(patchCall!.options!.body as string);
      expect(body.activo).toBe(true);
      expect(body.credenciales).toEqual({});
    });

    expect(screen.queryByText(/Debe completar todas las credenciales/i)).toBeNull();
  });

  // MEJORA (ticket Trello 6a62eb3669e64e3d5cf110d0): la página solo mostraba
  // campos vacíos sin ninguna guía de qué falta para activar el canal. El
  // checklist es puramente derivado del estado ya cargado (form actual +
  // tiene_credenciales) — no depende de desencriptar nada nuevo en el backend.
  it("CC-12: canal inactivo sin ningún campo lleno → checklist muestra los 4 campos de Rappi como pendientes", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });

    expect(screen.getByText(/Pasos para activar Rappi/i)).toBeInTheDocument();
    expect(screen.getByText("API Key pendiente")).toBeInTheDocument();
    expect(screen.getByText("API Secret pendiente")).toBeInTheDocument();
    expect(screen.getByText("Store ID pendiente")).toBeInTheDocument();
    expect(screen.getByText("Webhook Secret pendiente")).toBeInTheDocument();
  });

  // CC-13
  it("CC-13: al completar un campo en el formulario, el checklist lo marca como configurado en vivo", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });

    expect(screen.getByText("API Key pendiente")).toBeInTheDocument();

    const inputs = screen.getAllByPlaceholderText(/rk_live|ws_rappi|12345|whsec/);
    fireEvent.change(inputs[0], { target: { value: "rk_test_123" } });

    await waitFor(() => {
      expect(screen.getByText("API Key configurada")).toBeInTheDocument();
    });
    // Los demás siguen pendientes — no se marcan todos por completar uno solo
    expect(screen.getByText("API Secret pendiente")).toBeInTheDocument();
  });

  // CC-14
  it("CC-14: canal con credenciales ya guardadas (tiene_credenciales=true) → checklist muestra todos los campos configurados sin reescribirlos", async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      fetchCalls.push({ url, options });
      return Promise.resolve({
        ok: true,
        json: async () => [{ id: "cfg-1", canal_id: "rappi", activo: false, tiene_credenciales: true }],
      });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });

    // El formulario NO precarga las credenciales (siguen vacías por seguridad)...
    const inputs = screen.getAllByPlaceholderText(/rk_live|ws_rappi|12345|whsec/);
    inputs.forEach((input) => expect(input).toHaveValue(""));

    // ...pero el checklist sabe (vía tiene_credenciales) que YA están guardadas
    await waitFor(() => {
      expect(screen.getByText("API Key configurada")).toBeInTheDocument();
    });
    expect(screen.getByText("API Secret configurada")).toBeInTheDocument();
    expect(screen.getByText("Store ID configurada")).toBeInTheDocument();
    expect(screen.getByText("Webhook Secret configurada")).toBeInTheDocument();
  });

  // CC-15 — REGRESIÓN: el ticket menciona "Webhook registrado" como ejemplo,
  // pero /api/canales/webhook/[canal] solo soporta Rappi (PedidosYa/UberEats
  // devuelven "Canal no soportado") — el checklist NO debe inventar ese paso.
  it("CC-15: el checklist no incluye un paso de \"Webhook registrado\" que no está implementado para todos los canales", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Webhook registrado/i)).not.toBeInTheDocument();
  });

  // CC-16 — el checklist es específico de onboarding: una vez el canal está
  // activo, ya no aporta guía (todas las credenciales estaban completas para
  // llegar a ese estado) y no debe seguir ocupando espacio en la página.
  it("CC-16: canal ya activo → el checklist no se muestra", async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      fetchCalls.push({ url, options });
      return Promise.resolve({
        ok: true,
        json: async () => [{ id: "cfg-1", canal_id: "rappi", activo: true, tiene_credenciales: true }],
      });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Rappi")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Activo")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Pasos para activar/i)).not.toBeInTheDocument();
  });
});