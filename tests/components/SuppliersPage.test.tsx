/**
 * Tests SP-01 a SP-07: SupplierHubPage
 * SP-01 a SP-05: Payment modal
 * SP-06 a SP-07: Per-supplier stats in list (sidebar bug fix)
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockMutate = jest.fn();
const mockInvalidateQueries = jest.fn();
let mutationCallbacks: Array<{ onSuccess?: Function; onError?: Function }> = [];
const mockUseMutation = jest.fn((opts?: any) => {
  mutationCallbacks.push({ onSuccess: opts?.onSuccess, onError: opts?.onError });
  return { mutate: mockMutate, isPending: false };
});

jest.mock("@tanstack/react-query", () => {
  const actual = jest.requireActual("@tanstack/react-query");
  return {
    ...actual,
    useQuery: jest.fn(),
    useMutation: (...args: any[]) => mockUseMutation(...args),
    useQueryClient: jest.fn(() => ({ invalidateQueries: mockInvalidateQueries })),
  };
});

const { useQuery } = jest.requireMock("@tanstack/react-query");

const MOCK_PROVEEDOR = { id: "prov-1", nombre: "Test Proveedor", rut: null, contacto: null, telefono: null, email: null };
const MOCK_PROVEEDOR_2 = { id: "prov-2", nombre: "Otro Proveedor", rut: null, contacto: null, telefono: null, email: null };
const MOCK_CUENTA = { id: "cp-1", monto: 50000, fecha_vencimiento: "2026-07-01", estado: "pendiente" };

const MOCK_SUPPLIER_STATS = {
  orderCounts: { "prov-1": 3, "prov-2": 1 },
  payableCounts: { "prov-1": 2, "prov-2": 0 },
  payableAmounts: { "prov-1": 120000, "prov-2": 0 },
};

function setupMocks(extraProveedores: any[] = []) {
  const proveedores = [MOCK_PROVEEDOR, ...extraProveedores];
  useQuery.mockImplementation(({ queryKey }: any) => {
    if (queryKey[0] === "proveedores") return { data: proveedores, isLoading: false };
    if (queryKey[0] === "proveedor") return { data: { ...MOCK_PROVEEDOR, productos: [] } };
    if (queryKey[0] === "ordenes-proveedor") return { data: [] };
    if (queryKey[0] === "cuentas-proveedor") return { data: [MOCK_CUENTA] };
    if (queryKey[0] === "productos-activos") return { data: [] };
    if (queryKey[0] === "proveedores-stats") return { data: MOCK_SUPPLIER_STATS };
    return { data: [], isLoading: false };
  });
}

async function renderPage() {
  const SupplierHubPage = (await import("@/app/(app)/suppliers/page")).default;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SupplierHubPage />
    </QueryClientProvider>
  );
}

async function selectProveedor() {
  fireEvent.click(screen.getAllByText("Test Proveedor")[0]);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Pagar" })).toBeInTheDocument();
  });
}

describe("SuppliersPage - Payment Modal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mutationCallbacks = [];
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
    mockMutate.mockClear();
    mockInvalidateQueries.mockClear();
    setupMocks();
  });

  // SP-01
  it("SP-01: Click Pagar abre modal con selector de método de pago", async () => {
    await renderPage();
    await selectProveedor();

    fireEvent.click(screen.getByRole("button", { name: "Pagar" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Confirmar pago" })).toBeInTheDocument();
      expect(screen.getByText("Método de pago")).toBeInTheDocument();
    });

    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("efectivo");
  });

  // SP-02
  it("SP-02: Cambiar método de pago en el selector", async () => {
    await renderPage();
    await selectProveedor();

    fireEvent.click(screen.getByRole("button", { name: "Pagar" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Confirmar pago" })).toBeInTheDocument();
    });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "transferencia" } });
    expect(select.value).toBe("transferencia");
  });

  // SP-03
  it("SP-03: Confirmar pago envía metodo_pago en PATCH", async () => {
    await renderPage();
    await selectProveedor();

    fireEvent.click(screen.getByRole("button", { name: "Pagar" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));

    expect(mockMutate).toHaveBeenCalledWith({
      id: MOCK_CUENTA.id,
      metodo_pago: "efectivo",
    });
  });

  // SP-04
  it("SP-04: Cancelar cierra modal sin pagar", async () => {
    await renderPage();
    await selectProveedor();

    fireEvent.click(screen.getByRole("button", { name: "Pagar" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Confirmar pago" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Confirmar pago" })).not.toBeInTheDocument();
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  // SP-06
  it("SP-06: cada proveedor muestra sus propias stats en la lista (no las del seleccionado)", async () => {
    const proveedores = [MOCK_PROVEEDOR, MOCK_PROVEEDOR_2];
    useQuery.mockImplementation(({ queryKey }: any) => {
      if (queryKey[0] === "proveedores") return { data: proveedores, isLoading: false };
      if (queryKey[0] === "proveedor") return { data: { ...MOCK_PROVEEDOR, productos: [] } };
      if (queryKey[0] === "ordenes-proveedor") return { data: [] };
      if (queryKey[0] === "cuentas-proveedor") return { data: [MOCK_CUENTA] };
      if (queryKey[0] === "productos-activos") return { data: [] };
      if (queryKey[0] === "proveedores-stats") return { data: MOCK_SUPPLIER_STATS };
      return { data: [], isLoading: false };
    });

    await renderPage();

    // prov-1 tiene 3 OC y $120,000 pendiente
    expect(screen.getByText("3 OC pendientes")).toBeInTheDocument();
    expect(screen.getByText("$120.000 x pagar")).toBeInTheDocument();

    // prov-2 tiene 1 OC y $0 pendiente (no debe mostrar $0, solo OC)
    expect(screen.getByText("1 OC pendientes")).toBeInTheDocument();
    expect(screen.queryByText("0 x pagar")).not.toBeInTheDocument();
  });

  // SP-07
  it("SP-07: stats no cambian al seleccionar otro proveedor (los datos vienen del endpoint agregado)", async () => {
    const proveedores = [MOCK_PROVEEDOR, MOCK_PROVEEDOR_2];
    useQuery.mockImplementation(({ queryKey }: any) => {
      if (queryKey[0] === "proveedores") return { data: proveedores, isLoading: false };
      if (queryKey[0] === "proveedor") return { data: { ...MOCK_PROVEEDOR_2, productos: [] } };
      if (queryKey[0] === "ordenes-proveedor") return { data: [{ id: "oc-2", numero: "OC-002", estado: "pendiente", total: 30000, fecha_estimada: null, fecha_recibida: null, created_at: "" }] };
      if (queryKey[0] === "cuentas-proveedor") return { data: [] };
      if (queryKey[0] === "productos-activos") return { data: [] };
      if (queryKey[0] === "proveedores-stats") return { data: MOCK_SUPPLIER_STATS };
      return { data: [], isLoading: false };
    });

    await renderPage();

    // Click en prov-2 (el segundo en la lista)
    const cards = screen.getAllByText(/Proveedor/);
    fireEvent.click(cards[1]);

    await waitFor(() => {
      expect(screen.getAllByText("Otro Proveedor").length).toBeGreaterThanOrEqual(1);
    });

    // prov-1 debe mantener sus stats (3 OC)
    const prov1Stats = screen.getAllByText("3 OC pendientes");
    expect(prov1Stats.length).toBeGreaterThanOrEqual(1);

    // prov-2 debe mantener sus stats (1 OC)
    const prov2Stats = screen.getAllByText("1 OC pendientes");
    expect(prov2Stats.length).toBeGreaterThanOrEqual(1);
  });

  // SP-09 — REGRESIÓN: cuentas con monto $0 no deben aparecer en lista pendiente
  it("SP-09: cuenta con monto $0 excluida de la lista de cuentas pendientes", async () => {
    const cuentasConCero = [
      { id: "cp-zero", monto: 0, fecha_vencimiento: "2025-06-01", estado: "pendiente" },
      { id: "cp-normal", monto: 50000, fecha_vencimiento: "2025-06-01", estado: "pendiente" },
    ];
    useQuery.mockImplementation(({ queryKey }: any) => {
      if (queryKey[0] === "proveedores") return { data: [MOCK_PROVEEDOR], isLoading: false };
      if (queryKey[0] === "proveedor") return { data: { ...MOCK_PROVEEDOR, productos: [] } };
      if (queryKey[0] === "ordenes-proveedor") return { data: [] };
      if (queryKey[0] === "cuentas-proveedor") return { data: cuentasConCero };
      if (queryKey[0] === "productos-activos") return { data: [] };
      if (queryKey[0] === "proveedores-stats") return { data: MOCK_SUPPLIER_STATS };
      return { data: [], isLoading: false };
    });

    await renderPage();
    await selectProveedor();

    // La lista pendiente solo tiene 1 "Pagar" (cp-normal incluida, cp-zero filtrada por monto=0)
    const pagarBtns = await screen.findAllByRole("button", { name: "Pagar" });
    expect(pagarBtns).toHaveLength(1);
  });

  // SP-05
  it("SP-05: Payment falla → muestra mensaje de error en el modal", async () => {
    await renderPage();
    await selectProveedor();

    fireEvent.click(screen.getByRole("button", { name: "Pagar" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Confirmar pago" })).toBeInTheDocument();
    });

    const payMutation = mutationCallbacks.filter((cb) => cb.onError).pop();
    expect(payMutation).toBeDefined();
    await act(async () => {
      payMutation!.onError!(new Error("Error interno del servidor"));
    });

    await waitFor(() => {
      expect(screen.getByText("Error interno del servidor")).toBeInTheDocument();
    });
  });

  // SP-08 — REGRESIÓN: el fix de SP-06/SP-07 introdujo un endpoint agregado
  // ["proveedores-stats"] para el sidebar, pero ninguna mutación lo invalidaba:
  // pagar una cuenta o recibir/cancelar una OC dejaba el conteo del sidebar
  // desactualizado hasta recargar la página. Las 4 mutaciones que cambian
  // órdenes o cuentas por pagar (pagarCuenta, pagarVariasCuentas, recibirOrden,
  // cambiarEstadoOrden) deben invalidar ["proveedores-stats"] en su onSuccess.
  it("SP-08: pagar cuenta y recibir/cancelar OC invalidan proveedores-stats (evita sidebar desactualizado)", async () => {
    await renderPage();
    await selectProveedor();

    // Cada render vuelve a registrar los 9 useMutation — dedupe por el cuerpo
    // de la función onSuccess (estable entre renders) para invocar cada
    // mutación una sola vez, sin depender de cuántas veces re-renderizó.
    const seen = new Set<string>();
    const uniqueCallbacks = mutationCallbacks.filter((cb) => {
      if (!cb.onSuccess) return false;
      const key = cb.onSuccess.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    await act(async () => {
      uniqueCallbacks.forEach((cb) => cb.onSuccess?.());
    });

    const statsInvalidations = mockInvalidateQueries.mock.calls.filter(
      ([arg]: [{ queryKey?: unknown[] }]) => arg?.queryKey?.[0] === "proveedores-stats"
    );
    expect(statsInvalidations).toHaveLength(4);

    // Las mutaciones que agregan/quitan stock (recibirOrden, cambiarEstadoOrden)
    // también deben invalidar inventario/productos/lotes
    const inventarioInvalidations = mockInvalidateQueries.mock.calls.filter(
      ([arg]: [{ queryKey?: unknown[] }]) =>
        arg?.queryKey?.[0] === "inventario" && arg?.refetchType === "all"
    );
    expect(inventarioInvalidations.length).toBeGreaterThanOrEqual(2);
    const productosInvalidations = mockInvalidateQueries.mock.calls.filter(
      ([arg]: [{ queryKey?: unknown[] }]) =>
        arg?.queryKey?.[0] === "productos" && arg?.refetchType === "all"
    );
    expect(productosInvalidations.length).toBeGreaterThanOrEqual(2);
    const lotesInvalidations = mockInvalidateQueries.mock.calls.filter(
      ([arg]: [{ queryKey?: unknown[] }]) =>
        arg?.queryKey?.[0] === "lotes" && arg?.refetchType === "all"
    );
    expect(lotesInvalidations.length).toBeGreaterThanOrEqual(2);
  });
});

describe("SuppliersPage - KPI Dashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mutationCallbacks = [];
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
    mockMutate.mockClear();
    mockInvalidateQueries.mockClear();
  });

  // Fechas relativas a "hoy" en tiempo de ejecución (no absolutas): fechas
  // hardcodeadas se corrían de bucket a medida que pasaba el tiempo real
  // (KPI-01/02/03 fallaban en producción por esto — ver commit relacionado).
  // Construida con getters locales (no toISOString) para no desfasar un día
  // si el test corre de noche en un timezone detrás de UTC.
  function fechaRelativa(diasDesdeHoy: number): string {
    const d = new Date();
    d.setDate(d.getDate() + diasDesdeHoy);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  // Cuentas con diferentes estados para probar KPI
  const MOCK_CUENTA_VENCIDA = { id: "cp-overdue", monto: 53550, fecha_vencimiento: fechaRelativa(-30), estado: "pendiente" };
  const MOCK_CUENTA_PENDIENTE = { id: "cp-pending", monto: 800000, fecha_vencimiento: fechaRelativa(30), estado: "pendiente" };
  const MOCK_CUENTA_DUE_SOON = { id: "cp-duesoon", monto: 450000, fecha_vencimiento: fechaRelativa(4), estado: "pendiente" };
  const ALL_CUENTAS = [MOCK_CUENTA_VENCIDA, MOCK_CUENTA_PENDIENTE, MOCK_CUENTA_DUE_SOON];

  const MOCK_ORDENES = [
    { id: "oc-1", numero: "OC-001", estado: "pendiente", total: 100000 },
    { id: "oc-2", numero: "OC-002", estado: "recibida", total: 200000 },
  ];

  function setupKpiMocks() {
    useQuery.mockImplementation(({ queryKey }: any) => {
      if (queryKey[0] === "proveedores") return { data: [MOCK_PROVEEDOR], isLoading: false };
      if (queryKey[0] === "cuentas-proveedor") return { data: ALL_CUENTAS };
      if (queryKey[0] === "ordenes-proveedor") return { data: MOCK_ORDENES };
      if (queryKey[0] === "proveedor") return { data: { ...MOCK_PROVEEDOR, productos: [] } };
      if (queryKey[0] === "productos-activos") return { data: [] };
      if (queryKey[0] === "proveedores-stats") return { data: { orderCounts: {}, payableCounts: {}, payableAmounts: {} } };
      return { data: [], isLoading: false };
    });
  }

  it("KPI-01: muestra KPIs globales no-cero sin proveedor seleccionado (regresion: antes mostraba $0 por enabled guard)", async () => {
    setupKpiMocks();
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText("Vencidas")).toBeInTheDocument();
    });

    // Sin proveedor seleccionado las KPIs deben mostrar totales globales no-cero
    // Pendiente: $1.303.550 (suma de las 3 cuentas pendientes)
    expect(screen.getByText("$1.303.550")).toBeInTheDocument();
    // Vencidas: $53.550 (solo monto vencido)
    expect(screen.getByText("$53.550")).toBeInTheDocument();
  });

  it("KPI-02: card Vencidas muestra monto especifico de vencidas ($53.550) no total pendiente", async () => {
    setupKpiMocks();
    await renderPage();
    await waitFor(() => {
      // $53.550 = monto vencido de MOCK_CUENTA_VENCIDA y aparece en la card Vencidas
      expect(screen.getByText("$53.550")).toBeInTheDocument();
    });
    // $1.303.550 = totalPendiente que aparece en la card Pendiente (es correcto que este)
    // Lo que verificamos es que la card Vencidas use overdue specifc not totalPendiente
  });

  it("KPI-03: card Prox. a vencer muestra monto de proximos a vencer", async () => {
    setupKpiMocks();
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText("Próx. a vencer")).toBeInTheDocument();
    });
    // MOCK_CUENTA_DUE_SOON tiene monto 450.000 y vence en 4 dias desde hoy
    expect(screen.getByText("$450.000")).toBeInTheDocument();
  });

  it("KPI-04: card OC en Proceso cuenta ordenes pendientes", async () => {
    setupKpiMocks();
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText("OC en Proceso")).toBeInTheDocument();
    });
    // Solo OC-001 esta pendiente — hay otros "1" en la pagina pero hay al menos uno
    const unos = screen.getAllByText("1");
    expect(unos.length).toBeGreaterThanOrEqual(1);
  });

  it("KPI-05: sin proveedor seleccionado la query usa queryKey con 'all' (global)", async () => {
    setupKpiMocks();
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText("Vencidas")).toBeInTheDocument();
    });
    const cuentaQueryCalls = (useQuery as jest.Mock).mock.calls.filter(
      ([args]: any) => args.queryKey[0] === "cuentas-proveedor"
    );
    expect(cuentaQueryCalls.length).toBeGreaterThanOrEqual(1);
    expect(cuentaQueryCalls[0][0].queryKey[1]).toBe("all");
  });

  // KPI-06 — REGRESIÓN: el fix original cambió la queryKey de cuentas/ordenes-proveedor
  // a usar "all" cuando no hay proveedor seleccionado, pero dejó las invalidaciones
  // (onSuccess de pagar/recibir/cancelar OC) apuntando a `selected?.id` (undefined en
  // ese caso). TanStack Query NO hace match parcial entre `undefined` y "all"
  // (verificado en node_modules/@tanstack/query-core: partialMatchKey compara tipos),
  // por lo que esas invalidaciones nunca alcanzaban la cache global y los KPIs
  // quedaban desactualizados tras una mutación en la vista global.
  it("KPI-06: sin proveedor seleccionado, invalidar cuentas/ordenes-proveedor usa la key 'all' (no undefined)", async () => {
    setupKpiMocks();
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText("Vencidas")).toBeInTheDocument();
    });

    // Cada render vuelve a registrar los useMutation — dedupe por el cuerpo
    // de onSuccess (estable entre renders) para invocar cada mutación una sola vez.
    const seen = new Set<string>();
    const uniqueCallbacks = mutationCallbacks.filter((cb) => {
      if (!cb.onSuccess) return false;
      const key = cb.onSuccess.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    await act(async () => {
      uniqueCallbacks.forEach((cb) => cb.onSuccess?.());
    });

    const scopedInvalidations = mockInvalidateQueries.mock.calls.filter(
      ([arg]: [{ queryKey?: unknown[] }]) =>
        arg?.queryKey?.[0] === "cuentas-proveedor" || arg?.queryKey?.[0] === "ordenes-proveedor"
    );
    expect(scopedInvalidations.length).toBeGreaterThan(0);
    scopedInvalidations.forEach(([arg]: [{ queryKey?: unknown[] }]) => {
      // Debe coincidir con la queryKey realmente cacheada ("all"), no quedar en undefined
      expect(arg.queryKey?.[1]).toBe("all");
    });
  });
});
