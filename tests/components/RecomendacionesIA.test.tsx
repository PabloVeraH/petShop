/**
 * Tests C-REC-01 a C-REC-05: RecomendacionesIA
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import RecomendacionesIA from "@/app/(app)/pos/components/RecomendacionesIA";

const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock del store — controlar clienteId/items desde tests
const mockAddItem = jest.fn();
let mockClienteId: string | undefined = undefined;
let mockItems: { producto_id: string; nombre: string; precio: number }[] = [];

jest.mock("@/stores/pos", () => ({
  usePOSStore: () => ({
    clienteId:  mockClienteId,
    mascotaId:  undefined,
    items:      mockItems,
    addItem:    mockAddItem,
  }),
}));

const MOCK_RECS = [
  { producto_id: "prod-1", nombre: "Antiparasitario Frontline", precio: 12500, razon: "Invierno", urgencia: "alta" },
  { producto_id: "prod-2", nombre: "Snack Dental CET",          precio: 3990,  razon: "Dental",  urgencia: "baja" },
];

describe("RecomendacionesIA", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockAddItem.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ recomendaciones: MOCK_RECS }) });
  });
  afterEach(() => jest.useRealTimers());

  // C-REC-01: no renderiza cuando no hay clienteId
  it("C-REC-01: no renderiza cuando clienteId es undefined", () => {
    mockClienteId = undefined;
    const { container } = render(<RecomendacionesIA />);
    expect(container).toBeEmptyDOMElement();
  });

  // C-REC-02: muestra spinner mientras carga (tras debounce)
  it("C-REC-02: muestra 'Buscando sugerencias' mientras carga", async () => {
    mockClienteId = "cliente-1";
    mockFetch.mockImplementation(() => new Promise(() => {})); // nunca resuelve
    render(<RecomendacionesIA />);
    act(() => jest.advanceTimersByTime(900)); // avanzar debounce
    await waitFor(() => {
      expect(screen.getByText(/buscando sugerencias/i)).toBeInTheDocument();
    });
  });

  // C-REC-03: muestra recomendaciones con razón y precio
  it("C-REC-03: muestra nombre, razón y precio de cada recomendación", async () => {
    mockClienteId = "cliente-1";
    render(<RecomendacionesIA />);
    act(() => jest.advanceTimersByTime(900));
    await waitFor(() => {
      expect(screen.getByText("Antiparasitario Frontline")).toBeInTheDocument();
      expect(screen.getByText("Invierno")).toBeInTheDocument();
      expect(screen.getByText("$12.500")).toBeInTheDocument();
    });
  });

  // C-REC-04: botón "+" llama a addItem del store
  it("C-REC-04: botón + llama a addItem con los datos correctos", async () => {
    mockClienteId = "cliente-1";
    render(<RecomendacionesIA />);
    act(() => jest.advanceTimersByTime(900));
    await waitFor(() => screen.getAllByRole("button", { name: "+" }));
    fireEvent.click(screen.getAllByRole("button", { name: "+" })[0]);
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({ producto_id: "prod-1", cantidad: 1 })
    );
  });

  // C-REC-05: error silencioso — no renderiza nada si la API falla
  it("C-REC-05: no muestra nada si la API retorna error", async () => {
    mockClienteId = "cliente-1";
    mockFetch.mockResolvedValue({ ok: false, status: 502 });
    const { container } = render(<RecomendacionesIA />);
    act(() => jest.advanceTimersByTime(900));
    await waitFor(() => {
      // El componente se oculta silenciosamente
      expect(container.querySelector(".rounded-lg")).toBeNull();
    });
  });

  // Test adicional: muestra indicador de urgencia
  it("C-REC-06: muestra badges de urgencia con colores correctos", async () => {
    mockClienteId = "cliente-1";
    render(<RecomendacionesIA />);
    act(() => jest.advanceTimersByTime(900));
    await waitFor(() => {
      expect(screen.getByText("alta")).toHaveClass("bg-red-100");
      expect(screen.getByText("baja")).toHaveClass("bg-green-100");
    });
  });

  // Test adicional: botón cambia a "✓" cuando se agrega
  it("C-REC-07: botón cambia a ✓ después de agregar producto", async () => {
    mockClienteId = "cliente-1";
    render(<RecomendacionesIA />);
    act(() => jest.advanceTimersByTime(900));
    await waitFor(() => screen.getAllByRole("button", { name: "+" }));
    
    // Agregar primer producto
    fireEvent.click(screen.getAllByRole("button", { name: "+" })[0]);
    await waitFor(() => {
      expect(screen.getAllByRole("button")[0]).toHaveTextContent("✓");
    });
    
    // Verificar que el segundo botón sigue siendo "+"
    expect(screen.getAllByRole("button")[1]).toHaveTextContent("+");
  });

  // Test adicional: no recarga cuando items cambian (debounce con clienteId/mascotaId solo)
  it("C-REC-08: no recarga cuando items cambian pero clienteId/mascotaId son los mismos", async () => {
    mockClienteId = "cliente-1";
    render(<RecomendacionesIA />);
    
    // Agregar item al carrito
    mockItems.push({ producto_id: "new-item", nombre: "New Product", precio: 1000 });
    
    // Esperar debounce pero no debería haber llamado a fetch
    act(() => jest.advanceTimersByTime(900));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1); // solo el llamado inicial
    });
  });
});