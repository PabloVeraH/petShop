/**
 * Tests C-OPT-01 a C-OPT-07: OptimizadorVencimientosTab
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OptimizadorVencimientosTab } from "@/app/(app)/inventory/components/OptimizadorVencimientosTab";

const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock navigator.clipboard
Object.assign(navigator, {
  clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
});

const MOCK_RECOMENDACION = {
  producto_id: "prod-1",
  urgencia: "alta",
  estrategia: "descuento",
  descuento_sugerido_pct: 30,
  precio_oferta_sugerido: 17500,
  razon: "Vence en 7 días.",
  mensaje_whatsapp: "Oferta 30% en Royal Canin!",
};

const MOCK_RESULTADO = {
  recomendaciones: [MOCK_RECOMENDACION],
  modelo_usado: "z-ai/glm-4.5-air:free",
  productos_analizados: 1,
};

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><OptimizadorVencimientosTab /></QueryClientProvider>
  );
}

describe("OptimizadorVencimientosTab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default para el GET de historial que dispara useEffect en mount
    mockFetch.mockResolvedValue({ ok: false });
  });

  // C-OPT-01
  it("C-OPT-01: muestra botón 'Analizar con IA' y input de días", () => {
    renderTab();
    expect(screen.getByRole("button", { name: /analizar/i })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toBeInTheDocument(); // input number
  });

  // C-OPT-02
  it("C-OPT-02: muestra spinner mientras analiza", async () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // nunca resuelve
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /analizar/i }));
    await waitFor(() => {
      expect(screen.getByText(/analizando/i)).toBeInTheDocument();
    });
  });

  // C-OPT-03
  it("C-OPT-03: muestra tabla con recomendaciones después del análisis", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => MOCK_RESULTADO });
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /analizar/i }));
    await waitFor(() => {
      expect(screen.getByText("Recomendaciones de IA")).toBeInTheDocument();
    });
  });

  // C-OPT-04
  it("C-OPT-04: badge de urgencia 'alta' tiene clase rojo", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => MOCK_RESULTADO });
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /analizar/i }));
    await waitFor(() => {
      const badge = screen.getByText("alta");
      expect(badge.className).toMatch(/red/);
    });
  });

  // C-OPT-05
  it("C-OPT-05: botón 'Aplicar descuento' llama al PATCH y muestra '✓ Aplicado'", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false })                                        // GET historial (mount)
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_RESULTADO })       // POST optimizar
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "prod-1" }) }); // PATCH producto
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /analizar/i }));
    await waitFor(() => screen.getByRole("button", { name: /aplicar descuento/i }));
    fireEvent.click(screen.getByRole("button", { name: /aplicar descuento/i }));
    await waitFor(() => {
      expect(screen.getByText(/aplicado/i)).toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/productos\/prod-1/),
      expect.objectContaining({ method: "PATCH" })
    );
  });

  // C-OPT-06
  it("C-OPT-06: botón WA copia el mensaje al portapapeles", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => MOCK_RESULTADO });
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /analizar/i }));
    await waitFor(() => screen.getByRole("button", { name: /wa|whatsapp|copiar/i }));
    fireEvent.click(screen.getByRole("button", { name: /wa|whatsapp|copiar/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Oferta 30% en Royal Canin!");
  });

  // C-OPT-07
  it("C-OPT-07: muestra estado vacío cuando no hay productos próximos a vencer", async () => {
    mockFetch.mockResolvedValue({
      ok: true, 
      json: async () => ({ 
        recomendaciones: [], 
        modelo_usado: "z-ai/glm-4.5-air:free", 
        productos_analizados: 0
      }),
    });
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /analizar/i }));
    await waitFor(() => {
      expect(screen.getByText(/no hay productos|ningún producto/i)).toBeInTheDocument();
    });
  });
});