/**
 * Test MC-31: fidelización — descuento automático de punta a punta.
 * @jest-environment jsdom
 *
 * MC-27..30 (ModalCliente.test.tsx) y S-28..31 (pos-store.test.ts) prueban por
 * separado: (a) que ModalCliente llama a `setCliente(id, mascotaId, descuento,
 * email)` con el descuento real de fidelización, y (b) que `setCliente` del
 * store aplica ese valor a `descuento` (el campo que usa calcularTotalCarrito).
 * Ninguno de los dos prueba la cadena completa con el store REAL: que al
 * confirmar un cliente en el ModalCliente real, el Carrito real —leyendo del
 * mismo store— efectivamente muestra el total con el descuento ya aplicado,
 * sin que el vendedor tenga que hacer nada más. Este test cierra ese último
 * eslabón usando el store real (sin mockear @/stores/pos) y renderizando
 * ModalCliente y Carrito contra la misma instancia de usePOSStore.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactNode } from "react";

const mockGetClienteByRUT = jest.fn();
const mockGetMascotasByCliente = jest.fn();

jest.mock("@/app/(app)/pos/api", () => ({
  getClienteByRUT: (...args: unknown[]) => mockGetClienteByRUT(...args),
  getMascotasByCliente: (...args: unknown[]) => mockGetMascotasByCliente(...args),
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

import { usePOSStore } from "@/stores/pos";
import ModalCliente from "@/app/(app)/pos/components/ModalCliente";
import Carrito from "@/app/(app)/pos/components/Carrito";

const CLIENTE = { id: "cli-1", nombre: "María González", rut: "15.855.267-1", email: "maria@test.com", telefono: null };

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe("Fidelización — descuento automático de punta a punta (MC-31)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    usePOSStore.getState().clearCart();
    jest.clearAllMocks();

    usePOSStore.getState().addItem({
      producto_id: "prod-1",
      nombre: "Alimento Premium",
      precio: 10000,
      cantidad: 1,
      subtotal: 10000,
    });

    mockGetClienteByRUT.mockResolvedValue(CLIENTE);
    mockGetMascotasByCliente.mockResolvedValue([]);
    (global.fetch as jest.Mock) = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/fidelizacion")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            total_historico: 150_000,
            frecuencia_compras: 5,
            descuento_actual: 10,
            niveles: [{ monto: 50000, descuento: 5 }, { monto: 150000, descuento: 10 }],
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => null });
    });
  });

  afterEach(() => {
    cleanup();
    act(() => usePOSStore.getState().clearCart());
    window.localStorage.clear();
  });

  // MC-31: REGRESIÓN — seleccionar un cliente con fidelización activa (10%)
  // aplica el descuento al total del carrito SIN acción manual del vendedor.
  it("MC-31: confirmar cliente con 10% de fidelización descuenta el total en el Carrito real, sin clic manual", async () => {
    const Wrapper = makeWrapper();
    const onClose = jest.fn();
    const modal = render(
      <Wrapper>
        <ModalCliente onClose={onClose} />
      </Wrapper>
    );

    const input = screen.getByPlaceholderText("12.345.678-9");
    fireEvent.change(input, { target: { value: "158552671" } });

    await waitFor(() => expect(screen.getByText("María González")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Fidelización: 10%/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    // El store real ya debe reflejar el descuento sin ninguna interacción adicional.
    expect(usePOSStore.getState().descuento).toBe(10);

    // Y el Carrito real, leyendo del mismo store, muestra el total ya descontado —
    // esto es lo que el vendedor ve en pantalla, sin tener que aplicar nada a mano.
    // La etiqueta dice específicamente "fidelización" (ticket Trello
    // 6a62eb2efd10640e778299af) mientras el descuento activo siga igual al
    // nivel del cliente — comunica al cajero y al cliente por qué se aplicó.
    modal.unmount();
    render(<Carrito />);
    expect(screen.getByText("Descuento fidelización (10%)")).toBeInTheDocument();
    expect(screen.getByText("−$1.000")).toBeInTheDocument();
    expect(screen.getByText("$9.000")).toBeInTheDocument(); // Total: 10.000 - 10%
  });
});
