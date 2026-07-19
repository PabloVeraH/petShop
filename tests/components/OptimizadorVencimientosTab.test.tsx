/**
 * Tests C-OPT-01 a C-OPT-07: OptimizadorVencimientosTab
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    headers: new Map([["content-type", "application/json"]]),
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

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
    mockFetch.mockResolvedValue(jsonResponse(null, false));
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
    mockFetch.mockResolvedValue(jsonResponse(MOCK_RESULTADO));
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /analizar/i }));
    await waitFor(() => {
      expect(screen.getByText("Recomendaciones de IA")).toBeInTheDocument();
    });
  });

  // C-OPT-04
  it("C-OPT-04: badge de urgencia 'alta' tiene clase rojo", async () => {
    mockFetch.mockResolvedValue(jsonResponse(MOCK_RESULTADO));
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
      .mockResolvedValueOnce(jsonResponse(null, false))                      // GET historial (mount)
      .mockResolvedValueOnce(jsonResponse(MOCK_RESULTADO))                   // POST optimizar
      .mockResolvedValueOnce(jsonResponse({ id: "prod-1" }));                // PATCH producto
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
    mockFetch.mockResolvedValue(jsonResponse(MOCK_RESULTADO));
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /analizar/i }));
    await waitFor(() => screen.getByRole("button", { name: /wa|whatsapp|copiar/i }));
    fireEvent.click(screen.getByRole("button", { name: /wa|whatsapp|copiar/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Oferta 30% en Royal Canin!");
  });

  // C-OPT-09: muestra warning cuando productos_obsoletos > 0
  it("C-OPT-09: muestra advertencia cuando hay productos obsoletos filtrados del análisis cacheado", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      recomendaciones: [MOCK_RECOMENDACION],
      modelo_usado: "test",
      productos_analizados: 3,
      productos_obsoletos: 2,
    }));
    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/recomendación.*omitidas|omitidas.*recomendaci/i)).toBeInTheDocument();
    });
  });

  // C-OPT-08
  it("C-OPT-08: muestra error amigable cuando el servidor retorna HTML en vez de JSON (previene Unexpected token '<')", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false })                                       // GET historial (mount)
      .mockResolvedValueOnce({                                                     // POST devuelve HTML
        ok: true,
        headers: new Map([["content-type", "text/html; charset=utf-8"]]),
        json: async () => { throw new Error("Unexpected token '<'"); },
        text: async () => "<html>Gateway Timeout</html>",
      });
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /analizar/i }));
    await waitFor(() => {
      // Debe mostrar mensaje amigable, no "Unexpected token '<'"
      expect(screen.getByText(/servicio de IA|intente de nuevo/i)).toBeInTheDocument();
    });
  });

  // C-OPT-10: timeout defensivo del cliente ante backend que no responde
  it("C-OPT-10: muestra mensaje de timeout cuando el backend no responde dentro del límite del cliente", async () => {
    jest.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(jsonResponse(null, false)) // GET historial (mount)
      .mockImplementationOnce((_url: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          }, { once: true });
        })
      );
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /analizar/i }));
    act(() => {
      jest.advanceTimersByTime(55000);
    });
    await waitFor(() => {
      expect(screen.getByText(/tardando demasiado/i)).toBeInTheDocument();
    });
    jest.useRealTimers();
  });

  // C-OPT-07
  it("C-OPT-07: muestra estado vacío cuando no hay productos próximos a vencer", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      recomendaciones: [],
      modelo_usado: "z-ai/glm-4.5-air:free",
      productos_analizados: 0
    }));
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /analizar/i }));
    await waitFor(() => {
      expect(screen.getByText(/no hay productos|ningún producto/i)).toBeInTheDocument();
    });
  });

  // C-OPT-11: REGRESIÓN — el texto de una recomendación cacheada (razon,
  // mensaje_whatsapp) puede seguir siendo el del análisis original mientras
  // las columnas Días/Stock ya muestran datos en vivo refrescados por el
  // backend (ver GET /api/ai/vencimientos/optimizar). Sin una señal por
  // fila, la fila mezcla "vence en 1 día, 90 unidades" (texto) con
  // "105 días / 101" (columnas) sin ninguna advertencia visible. Cuando el
  // backend marca datos_desactualizados=true, la fila debe mostrar un aviso.
  it("C-OPT-11: REGRESIÓN — fila muestra aviso 'Texto desactualizado' cuando datos_desactualizados=true", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      recomendaciones: [{
        ...MOCK_RECOMENDACION,
        razon: "Vence en 1 día, quedan 90 unidades.",
        dias_hasta_vencer: 105,
        stock: 101,
        datos_desactualizados: true,
      }],
      modelo_usado: "z-ai/glm-4.5-air:free",
      productos_analizados: 1,
    }));
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("Vence en 1 día, quedan 90 unidades.")).toBeInTheDocument();
    });
    expect(screen.getByText("105")).toBeInTheDocument();
    expect(screen.getByText("101")).toBeInTheDocument();
    expect(screen.getByText(/texto desactualizado/i)).toBeInTheDocument();
  });

  // C-OPT-12: caso feliz — sin datos_desactualizados, no debe mostrarse el aviso.
  it("C-OPT-12: fila NO muestra aviso cuando datos_desactualizados es false/ausente", async () => {
    mockFetch.mockResolvedValue(jsonResponse(MOCK_RESULTADO));
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("Vence en 7 días.")).toBeInTheDocument();
    });
    expect(screen.queryByText(/texto desactualizado/i)).not.toBeInTheDocument();
  });

  // C-OPT-13: REGRESIÓN — botón "Aplicar descuento" deshabilitado cuando
  // datos_desactualizados=true. El fix anterior (C-OPT-11) agregó el badge
  // "Texto desactualizado" pero el botón seguía habilitado, permitiendo
  // aplicar un precio obsoleto generado por el LLM en el análisis original.
  it("C-OPT-13: REGRESIÓN — botón 'Aplicar descuento' deshabilitado cuando datos_desactualizados=true", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      recomendaciones: [{
        ...MOCK_RECOMENDACION,
        datos_desactualizados: true,
      }],
      modelo_usado: "test",
      productos_analizados: 1,
    }));
    renderTab();
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /aplicar descuento/i });
      expect(btn).toBeDisabled();
    });
  });

  // C-OPT-14: REGRESIÓN — handleAplicarDescuento no debe ejecutar PATCH
  // cuando datos_desactualizados=true. El fix anterior (C-OPT-11) agregó el
  // badge de advertencia pero el botón seguía habilitado y la función
  // ejecutaba el PATCH con precio_oferta_sugerido obsoleto. Ahora debe
  // mostrar error sin mutar el producto.
  it("C-OPT-14: REGRESIÓN — handleAplicarDescuento no ejecuta PATCH cuando datos_desactualizados=true", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      recomendaciones: [{
        ...MOCK_RECOMENDACION,
        datos_desactualizados: true,
      }],
      modelo_usado: "test",
      productos_analizados: 1,
    }));
    renderTab();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /aplicar descuento/i })).toBeDisabled();
    });
    // fetch no debe haber sido llamado con PATCH a productos
    const patchCalls = mockFetch.mock.calls.filter(
      ([url, opts]: [string, RequestInit]) => url.includes("/api/productos/") && opts?.method === "PATCH"
    );
    expect(patchCalls).toHaveLength(0);
  });
});