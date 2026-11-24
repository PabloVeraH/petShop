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

  // GR-U-17 / VSA-C-01 — contrato cambiado por la migración 096 (2026-11-23,
  // pedido de la tienda: un segundo punto de venta necesita su propio saco).
  // Antes exigía registrar la merma del resto; ahora pide confirmar y permite
  // nombrar el saco. Sin confirmar no se llama a la API.
  it("GR-U-17/VSA-C-01: con gramos en el saco, 'Abrí un saco nuevo' pide confirmar; al confirmar envía permitir_otro y el nombre", async () => {
    renderSearch();
    fireEvent.click(await screen.findByText("Abrí un saco nuevo"));
    expect(mockAccionSaco).not.toHaveBeenCalled();
    const dialogo = screen.getByRole("alertdialog", { name: "Confirmar otro saco abierto" });
    expect(dialogo).toHaveTextContent("Ya hay 1 saco abierto con 14.500 g");
    expect(dialogo).toHaveTextContent("quedarán 2 abiertos");

    fireEvent.change(screen.getByLabelText("Nombre del saco nuevo"), { target: { value: "  Mesón 2 " } });
    fireEvent.click(screen.getByText("Abrir otro saco"));
    await waitFor(() => expect(mockAccionSaco).toHaveBeenCalledWith("g1", { accion: "abrir", permitir_otro: true, nota: "Mesón 2" }));
  });

  it("VSA-C-01b: cancelar la confirmación no abre ningún saco", async () => {
    renderSearch();
    fireEvent.click(await screen.findByText("Abrí un saco nuevo"));
    fireEvent.click(screen.getByText("Cancelar"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mockAccionSaco).not.toHaveBeenCalled();
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

// GR-U-22 — REGRESIÓN (QA 2026-09-27, BUG 8): detalles de la tarjeta granel.
describe("SearchProductos — granel, maquetación (GR-U-22)", () => {
  it("GR-U-22: la fila de gramos hace wrap (Cancelar no se sale) y el motivo de merma ocupa su propia fila", async () => {
    renderSearch();
    fireEvent.click(await screen.findByText("Vender a granel"));
    fireEvent.change(screen.getByPlaceholderText("Gramos"), { target: { value: "500" } });
    expect(screen.getByPlaceholderText("Gramos").parentElement).toHaveClass("flex-wrap");
    fireEvent.click(screen.getByText("Cancelar"));

    fireEvent.click(await screen.findByText("Registrar merma"));
    const motivo = screen.getByLabelText("Motivo de la merma");
    expect(motivo).toHaveClass("w-full");
    expect(motivo).not.toHaveClass("min-w-0");
  });

  it("GR-U-22: stock con decimales sin saco abierto muestra el residuo, no '0 sacos + 0 kg' a secas", async () => {
    renderSearch([{ ...GRANEL, id: "g2", nombre: "Bravery", stock: 0.2, peso_gramos: 7000, saco_abierto_gramos: null }]);
    // Desde GR-U-24 el residuo va en una línea aparte del badge.
    expect(await screen.findByText("0 sacos + 0 kg")).toBeInTheDocument();
    expect(screen.getByText("(+0,2 saco sin asignar)")).toBeInTheDocument();
  });
});

// GR-U-23 — REGRESIÓN (QA 2026-09-27): con /api/productos en 429 la grilla del
// POS quedaba en blanco. Ahora avisa con el Retry-After (no "Sin resultados"),
// se recupera sola al vencer el plazo, y el escaneo muestra el error en vez de
// fallar en silencio.
import { ApiError } from "@/lib/api-client";

describe("SearchProductos — 429 (GR-U-23)", () => {
  const MSG = "Demasiadas solicitudes. Reintenta en 1 s.";

  it("GR-U-23: muestra 'Demasiadas solicitudes' y no 'Sin resultados'; al vencer el Retry-After vuelve a cargar", async () => {
    mockGetProductos.mockRejectedValueOnce(new ApiError(MSG, 429, 1)).mockResolvedValue([GRANEL]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><SearchProductos /></QueryClientProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent(MSG);
    expect(screen.queryByText("Sin resultados")).not.toBeInTheDocument();
    expect(await screen.findByText("Alimento granel", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(MSG)).not.toBeInTheDocument();
  });

  it("GR-U-23: un escaneo con la API en 429 muestra el error (antes: promesa rechazada sin manejar)", async () => {
    renderSearch();
    // renderSearch fija una lista válida; el 429 llega en la búsqueda del escaneo.
    mockGetProductos.mockRejectedValue(new ApiError(MSG, 429, 60));
    const input = screen.getByPlaceholderText("Buscar por nombre, SKU o código de barra...");
    fireEvent.change(input, { target: { value: "7801234567890" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getAllByText(new RegExp(MSG.replace(/[.]/g, "\\.")))).toHaveLength(2));
    expect(mockAddItem).not.toHaveBeenCalled();
  });
});

// GR-U-24 — REGRESIÓN (QA 2026-09-27): el badge (whitespace-nowrap, shrink-0)
// con "0 sacos + 0 kg (+0,2 saco sin asignar)" desbordaba la tarjeta y la
// grilla mostraba scroll horizontal. jsdom no calcula anchos: se verifica la
// estructura que lo evita (el ancho real se revisa a mano, ~375 px).
describe("SearchProductos — badge granel sin desborde (GR-U-24)", () => {
  it("GR-U-24: el badge lleva solo 'N sacos + X kg'; el residuo va en una línea aparte que puede partirse; la tarjeta no empuja la grilla", async () => {
    renderSearch([{ ...GRANEL, id: "g2", nombre: "Bravery Cerdo", stock: 0.2, peso_gramos: 7000, saco_abierto_gramos: null }]);
    const badge = await screen.findByText("0 sacos + 0 kg");
    expect(badge.textContent).toBe("0 sacos + 0 kg");
    const residuo = screen.getByText("(+0,2 saco sin asignar)");
    expect(residuo).not.toBe(badge);
    expect(badge.contains(residuo)).toBe(false);
    expect(residuo).toHaveClass("break-words");
    expect(residuo).toHaveAttribute("title", expect.stringMatching(/Conteo físico/));
    const tarjeta = screen.getByText("Bravery Cerdo").closest("div.relative") as HTMLElement;
    expect(tarjeta).toHaveClass("min-w-0");
  });

  it("GR-U-24: sin residuo no se agrega la línea extra", async () => {
    renderSearch();
    expect(await screen.findByText("9 sacos + 14,5 kg")).toBeInTheDocument();
    expect(screen.queryByText(/saco sin asignar/)).not.toBeInTheDocument();
  });
});


// VSA-C-02…05 — varios sacos abiertos del mismo producto (migración 096). La
// elección del saco en el POS es UX: la BD rechaza una venta sin saco con 2+
// abiertos y valida que el saco sea de este producto y tienda (VSA-SQL-04/06).
describe("SearchProductos — varios sacos abiertos (096)", () => {
  const DOS_SACOS = {
    ...GRANEL,
    peso_gramos: 20000,
    stock: 4.16,                       // 3 cerrados + 3 200 g + 20 000 g
    saco_abierto_gramos: 23200,
    sacos_abiertos: [
      { id: "s1", gramos_restantes: 3200, nota: "Mesón 1", abierto_at: "2026-11-23T12:00:00Z" },
      { id: "s2", gramos_restantes: 20000, nota: null, abierto_at: "2026-11-23T15:00:00Z" },
    ],
  };

  it("VSA-C-02: la tarjeta lista los sacos; vender exige elegir el saco y la línea lleva saco_id", async () => {
    renderSearch([DOS_SACOS]);
    expect(await screen.findByText(/2 sacos abiertos: Mesón 1 · 3,2 kg \| Saco 2 · 20 kg/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Vender a granel"));
    fireEvent.change(screen.getByPlaceholderText("Gramos"), { target: { value: "500" } });
    expect(screen.getByText("Agregar")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Saco del que se vende"), { target: { value: "s2" } });
    fireEvent.click(screen.getByText("Agregar"));
    expect(mockAddItem).toHaveBeenCalledWith(expect.objectContaining({ gramos: 500, es_granel: true, saco_id: "s2" }));
    expect(mockAddItem.mock.calls[0][0]).not.toHaveProperty("abrir_saco");
  });

  it("VSA-C-03: la apertura se decide con los gramos del saco elegido (y solo sus líneas en el carrito)", async () => {
    // 1 000 g ya en el carrito, pero del saco 2: no cuentan para el saco 1.
    mockItems = [{ id: "c1", producto_id: "g1", es_granel: true, gramos: 1000, saco_id: "s2", cantidad: 1, precio: 5000, subtotal: 5000 }];
    renderSearch([DOS_SACOS]);
    fireEvent.click(await screen.findByText("Vender a granel"));
    fireEvent.change(screen.getByLabelText("Saco del que se vende"), { target: { value: "s1" } });
    fireEvent.change(screen.getByPlaceholderText("Gramos"), { target: { value: "3000" } });
    fireEvent.click(screen.getByText("Agregar"));
    expect(mockAddItem).toHaveBeenCalledWith(expect.objectContaining({ gramos: 3000, saco_id: "s1" }));
    expect(mockAddItem.mock.calls[0][0]).not.toHaveProperty("abrir_saco");

    mockAddItem.mockClear();
    fireEvent.click(screen.getByText("Vender a granel"));
    fireEvent.change(screen.getByLabelText("Saco del que se vende"), { target: { value: "s1" } });
    fireEvent.change(screen.getByPlaceholderText("Gramos"), { target: { value: "4000" } });
    fireEvent.click(screen.getByText("Agregar"));
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Confirmar apertura de saco" })).toHaveTextContent("quedan 3200 g");
    fireEvent.click(screen.getByText("Abrir saco y agregar"));
    expect(mockAddItem).toHaveBeenCalledWith(expect.objectContaining({ gramos: 4000, saco_id: "s1", abrir_saco: true }));
  });

  it("VSA-C-04: la merma con varios sacos exige elegir cuál y envía su saco_id", async () => {
    renderSearch([DOS_SACOS]);
    fireEvent.click(await screen.findByText("Registrar merma"));
    fireEvent.change(screen.getByLabelText("Motivo de la merma"), { target: { value: "Saco húmedo" } });
    const confirmar = screen.getByText("Confirmar merma");
    expect(confirmar).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Saco de la merma"), { target: { value: "s1" } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);
    await waitFor(() => expect(mockAccionSaco).toHaveBeenCalledWith("g1", { accion: "merma", motivo: "Saco húmedo", saco_id: "s1" }));
  });

  it("VSA-C-05: si el servidor rechaza abrir otro saco, el error se muestra", async () => {
    mockAccionSaco.mockRejectedValue(new Error("Stock insuficiente: disponible 0, solicitado 1"));
    renderSearch([DOS_SACOS]);
    fireEvent.click(await screen.findByText("Abrí un saco nuevo"));
    expect(screen.getByRole("alertdialog", { name: "Confirmar otro saco abierto" })).toHaveTextContent("Ya hay 2 sacos abiertos con 23.200 g");
    fireEvent.click(screen.getByText("Abrir otro saco"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Stock insuficiente: disponible 0");
  });
});
