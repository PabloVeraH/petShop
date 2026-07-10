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
});