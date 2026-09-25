/**
 * Tests GR-U-11 a GR-U-19: SearchProductos (POS) — granel con saco abierto
 * (Fase 1b, §4.6, D18–D20, G1/G6).
 *
 * El componente es real; se simulan el store del carrito y la capa de API.
 * Lo que aquí se prueba es la experiencia del cajero (confirmación forzada,
 * acciones de saco, mensajes). La regla real vive en el servidor y la BD:
 * crear_venta_tx rechaza con 409 una venta que exceda el saco abierto sin
 * abrir_saco (I-589) y POST /api/productos/[id]/saco valida acción y tenant
 * (I-572..I-585).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockAddItem = jest.fn();
const mockAccionSaco = jest.fn();
const mockGetProductos = jest.fn();
let mockItems: Array<Record<string, unknown>> = [];

jest.mock("@/stores/pos", () => ({
  usePOSStore: () => ({ addItem: mockAddItem, mascotaId: undefined, items: mockItems }),
}));

jest.mock("@/app/(app)/pos/api", () => ({
  getProductos: (...a: unknown[]) => mockGetProductos(...a),
  accionSaco: (...a: unknown[]) => mockAccionSaco(...a),
}));

jest.mock("@/app/(app)/pos/components/BarcodeScanner", () => ({ __esModule: true, default: () => null }));

import SearchProductos from "@/app/(app)/pos/components/SearchProductos";

const GRANEL = {
  id: "g1",
  store_id: "s1",
  nombre: "Alimento granel",
  sku: "AG-1",
  precio: 60000,
  stock: 9.967,
  stock_minimo: 1,
  precio_venta_kg: 5000,
  peso_gramos: 15000,
  saco_abierto_gramos: 14500,
};

function renderSearch(productos: unknown[] = [GRANEL]) {
  mockGetProductos.mockResolvedValue(productos);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SearchProductos />
    </QueryClientProvider>
  );
}

async function venderGramos(gramos: string) {
  fireEvent.click(await screen.findByText("Vender a granel"));
  fireEvent.change(screen.getByPlaceholderText("Gramos"), { target: { value: gramos } });
  fireEvent.click(screen.getByText("Agregar"));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockItems = [];
  mockAccionSaco.mockResolvedValue({ saco: { id: "saco-1" }, stock: 10 });
});

// GR-U-05..10: antes eran placeholders `expect(true)` en
// tests/unit/components/SearchProductos-granel.test.tsx (fuera de todo
// proyecto de Jest, nunca se ejecutaban). Reemplazados aquí por tests reales.
describe("SearchProductos — venta a granel (input de gramos)", () => {
  it("GR-U-05: producto sin precio_venta_kg no muestra 'Vender a granel'", async () => {
    renderSearch([{ ...GRANEL, id: "u1", nombre: "Cama", precio_venta_kg: null, peso_gramos: null, saco_abierto_gramos: undefined, stock: 3 }]);
    expect(await screen.findByText("Cama")).toBeInTheDocument();
    expect(screen.queryByText("Vender a granel")).not.toBeInTheDocument();
  });

  it("GR-U-06: producto con precio_venta_kg > 0 muestra 'Vender a granel'", async () => {
    renderSearch();
    expect(await screen.findByText("Vender a granel")).toBeInTheDocument();
  });

  it("GR-U-07: al hacer click en 'Vender a granel' aparece el input de gramos", async () => {
    renderSearch();
    fireEvent.click(await screen.findByText("Vender a granel"));
    expect(screen.getByPlaceholderText("Gramos")).toBeInTheDocument();
  });

  it("GR-U-08: el precio se previsualiza mientras se escriben los gramos", async () => {
    renderSearch();
    fireEvent.click(await screen.findByText("Vender a granel"));
    fireEvent.change(screen.getByPlaceholderText("Gramos"), { target: { value: "500" } });
    expect(screen.getByText("= $2.500")).toBeInTheDocument();   // 0,5 kg × $5.000
  });

  it("GR-U-09: 'Agregar' con 500 g llama addItem con cantidad 0.5 y subtotal correcto", async () => {
    renderSearch();
    await venderGramos("500");
    expect(mockAddItem).toHaveBeenCalledWith(expect.objectContaining({
      cantidad: 0.5, gramos: 500, precio: 5000, subtotal: 2500, es_granel: true,
    }));
  });

  it("GR-U-10: 'Agregar' deshabilitado con gramos vacío o 0", async () => {
    renderSearch();
    fireEvent.click(await screen.findByText("Vender a granel"));
    expect(screen.getByText("Agregar")).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Gramos"), { target: { value: "0" } });
    expect(screen.getByText("Agregar")).toBeDisabled();
  });
});

describe("SearchProductos — granel", () => {
  it("GR-U-11: muestra 'N sacos + X kg' y los gramos del saco abierto (G11)", async () => {
    renderSearch();
    expect(await screen.findByText("9 sacos + 14,5 kg")).toBeInTheDocument();
    expect(screen.getByText(/saco abierto: 14\.500 g/)).toBeInTheDocument();
  });

  it("GR-U-12: 500 g con gramos suficientes en el saco → addItem sin abrir_saco", async () => {
    renderSearch();
    await venderGramos("500");
    expect(mockAddItem).toHaveBeenCalledWith(expect.objectContaining({
      producto_id: "g1",
      es_granel: true,
      gramos: 500,
      cantidad: 0.5,
      subtotal: 2500,
    }));
    expect(mockAddItem.mock.calls[0][0]).not.toHaveProperty("abrir_saco");
  });

  // G1: el saco abierto no alcanza → hay que confirmar la apertura.
  it("GR-U-13: gramos que exceden el saco abierto exigen confirmar; al confirmar viaja abrir_saco", async () => {
    renderSearch();
    await venderGramos("15000");
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Confirmar apertura de saco" })).toHaveTextContent("quedan 14500 g");

    fireEvent.click(screen.getByText("Abrir saco y agregar"));
    expect(mockAddItem).toHaveBeenCalledWith(expect.objectContaining({ gramos: 15000, abrir_saco: true }));
  });

  it("GR-U-14: los gramos granel ya en el carrito cuentan para decidir la apertura", async () => {
    mockItems = [{ id: "c1", producto_id: "g1", es_granel: true, gramos: 14400, cantidad: 14.4, precio: 5000, subtotal: 72000 }];
    renderSearch();
    await venderGramos("200");
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancelar"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it("GR-U-15: más gramos que el stock total (abierto + cerrados) → error, no agrega", async () => {
    renderSearch([{ ...GRANEL, stock: 1.967 }]);   // 1 cerrado + 14 500 g
    await venderGramos("30000");
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Stock insuficiente");
  });

  // D18: "Abrí un saco nuevo".
  it("GR-U-16: sin saco abierto, 'Abrí un saco nuevo' llama POST de apertura", async () => {
    renderSearch([{ ...GRANEL, stock: 10, saco_abierto_gramos: null }]);
    fireEvent.click(await screen.findByText("Abrí un saco nuevo"));
    await waitFor(() => expect(mockAccionSaco).toHaveBeenCalledWith("g1", { accion: "abrir" }));
  });

  // G6: con gramos en el saco abierto, primero la merma del resto.
  it("GR-U-17: con gramos en el saco, 'Abrí un saco nuevo' pide la merma y no llama a la API", async () => {
    renderSearch();
    fireEvent.click(await screen.findByText("Abrí un saco nuevo"));
    expect(mockAccionSaco).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("registra la merma del resto");
    expect(screen.getByLabelText("Motivo de la merma")).toBeInTheDocument();
  });

  it("GR-U-18: merma exige motivo (≥ 5) y envía accion 'merma' con el motivo", async () => {
    renderSearch();
    fireEvent.click(await screen.findByText("Registrar merma"));
    const confirmar = screen.getByText("Confirmar merma");
    fireEvent.change(screen.getByLabelText("Motivo de la merma"), { target: { value: "abc" } });
    expect(confirmar).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Motivo de la merma"), { target: { value: "Saco húmedo" } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);
    await waitFor(() => expect(mockAccionSaco).toHaveBeenCalledWith("g1", { accion: "merma", motivo: "Saco húmedo" }));
  });

  it("GR-U-19: error de la API del saco se muestra en pantalla", async () => {
    mockAccionSaco.mockRejectedValue(new Error("Stock insuficiente: disponible 0, solicitado 1"));
    renderSearch([{ ...GRANEL, stock: 10, saco_abierto_gramos: null }]);
    fireEvent.click(await screen.findByText("Abrí un saco nuevo"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Stock insuficiente: disponible 0");
  });

  // I5: vender el saco entero solo con sacos CERRADOS (el abierto va por gramos).
  it("GR-U-20: sin sacos cerrados, clic en la tarjeta no agrega un saco entero", async () => {
    renderSearch([{ ...GRANEL, stock: 1.5, peso_gramos: 10000, saco_abierto_gramos: 15000 }]);
    fireEvent.click(await screen.findByText("Alimento granel"));
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(screen.getByText(/Stock máximo alcanzado: 0/)).toBeInTheDocument();
  });
});
