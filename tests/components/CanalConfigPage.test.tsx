/**
 * Tests CC-01 a CC-04: Canal config page — activo toggle en POST
 *
 * CC-01: Guardar sin tocar el toggle → envía activo=false
 * CC-02: Guardar sin credenciales → canal queda inactivo (no se activa automáticamente)
 * CC-03: POST retorna activo=true → frontend sincroniza a true
 * CC-04: Activar toggle sin credenciales → muestra error, no envía request
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

    // Llenar credencial primero (necesario para activar)
    const inputs = screen.getAllByPlaceholderText(/rk_live|ws_rappi|12345|whsec/);
    fireEvent.change(inputs[0], { target: { value: "rk_test_123" } });

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
      expect(screen.getByText(/debe ingresar al menos una credencial/i)).toBeInTheDocument();
    });

    // No se envió ningún fetch nuevo
    expect(fetchCalls.length).toBe(initialFetchCount);
  });
});