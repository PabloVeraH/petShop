/**
 * Tests CO-05 a CO-08: RappiOrdenesPage — manejo de error al aceptar/rechazar
 * Mismo comportamiento que PedidosYaOrdenesPage.test.tsx (CO-01 a CO-04) —
 * ver ese archivo para el contexto del fix.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const ORDEN_PENDING = {
  id: "orden-1",
  external_order_id: "EXT-001",
  estado: "pending",
  total_externo: 15000,
  created_at: "2026-08-28T12:00:00Z",
};

async function renderPage() {
  const RappiOrdenesPage = (await import("@/app/(app)/canales/rappi/ordenes/page")).default;
  return render(React.createElement(RappiOrdenesPage));
}

describe("RappiOrdenesPage — banner de error en accept/reject", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("CO-05: renderiza la orden pendiente obtenida de GET /api/canales/orders", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => [ORDEN_PENDING] });
    renderPage();

    expect(await screen.findByText("#EXT-001")).toBeInTheDocument();
    expect(screen.getByText("Aceptar")).toBeInTheDocument();
  });

  it("CO-06: accept exitoso refresca la lista y no muestra banner de error", async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ status: "accepted", ventaId: "v1", total: 15000 }) });
      }
      return Promise.resolve({ ok: true, json: async () => [ORDEN_PENDING] });
    });
    renderPage();

    await screen.findByText("#EXT-001");
    fireEvent.click(screen.getByText("Aceptar"));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find((c) => c[1]?.method === "POST");
      expect(postCall![0]).toBe("/api/canales/orders/orden-1/accept");
    });
    expect(screen.queryByLabelText("Cerrar")).not.toBeInTheDocument();
  });

  it("CO-07: REGRESIÓN — accept fallido (422 stock insuficiente) muestra el mensaje del backend", async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: "Stock insuficiente — SKU-1: disponible 1, solicitado 2" }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [ORDEN_PENDING] });
    });
    renderPage();

    await screen.findByText("#EXT-001");
    fireEvent.click(screen.getByText("Aceptar"));

    expect(await screen.findByText(/Stock insuficiente — SKU-1/)).toBeInTheDocument();
  });

  it("CO-08: el botón de cerrar limpia el banner de error", async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        return Promise.resolve({ ok: false, json: async () => ({ error: "Orden no encontrada" }) });
      }
      return Promise.resolve({ ok: true, json: async () => [ORDEN_PENDING] });
    });
    renderPage();

    await screen.findByText("#EXT-001");
    fireEvent.click(screen.getByText("Aceptar"));
    await screen.findByText("Orden no encontrada");

    fireEvent.click(screen.getByLabelText("Cerrar"));
    expect(screen.queryByText("Orden no encontrada")).not.toBeInTheDocument();
  });
});
