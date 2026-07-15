/**
 * Tests C-07 a C-13: InventoryPage — tabs, renderizado y controles de admin
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("@clerk/nextjs", () => ({ useUser: jest.fn() }));

jest.mock("@/app/(app)/inventory/components/LotesPanel", () => ({
  LotesPanel: () => <div data-testid="lotes-panel" />,
}));

jest.mock("@/app/(app)/inventory/components/CategoriasTab", () => ({
  CategoriasTab: () => <div data-testid="categorias-tab" />,
}));

jest.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children, className }: { children: ReactNode; className?: string }) => (
    <tr className={className}>{children}</tr>
  ),
  TableHead: ({ children }: { children: ReactNode }) => <th>{children}</th>,
  TableCell: ({ children, className }: { children: ReactNode; className?: string }) => <td className={className}>{children}</td>,
}));

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant }: { children: ReactNode; variant?: string }) => (
    <span data-variant={variant}>{children}</span>
  ),
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children, onClick, disabled, variant, size,
  }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: string; size?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}));

// fetch no existe en jsdom — definir antes de cualquier test
global.fetch = jest.fn();

// ── Imports after mocks ───────────────────────────────────────────────────────

import { useUser } from "@clerk/nextjs";
import InventoryPage from "@/app/(app)/inventory/page";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function mockAsAdmin(systemAdmin = false) {
  (useUser as jest.Mock).mockReturnValue({
    user: { publicMetadata: systemAdmin ? { systemAdmin: true } : { storeAdmin: true } },
  });
}

function mockAsWorker() {
  (useUser as jest.Mock).mockReturnValue({ user: { publicMetadata: {} } });
}

const PRODUCTO = {
  id: "p1",
  nombre: "Alimento Premium",
  sku: "SKU-001",
  precio: 10000,
  costo: 5000,
  stock: 15,
  stock_minimo: 5,
  marca: null,
  peso_gramos: null,
  fecha_vencimiento: null,
  dias_alerta_expira: 30,
  precio_oferta: null,
  en_oferta: false,
  categoria_id: null,
  codigo_barra: null,
};

const PRODUCTO_BAJO_STOCK = { ...PRODUCTO, id: "p2", nombre: "Snack Perro", stock: 3, stock_minimo: 5 };

function setupFetch(productos = [PRODUCTO]) {
  (global.fetch as jest.Mock).mockImplementation((url: RequestInfo | URL) => {
    const u = url.toString();
    if (u.includes("/api/inventario")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(productos) } as Response);
    }
    if (u.includes("/api/categorias")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InventoryPage — tabs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetch();
  });

  // C-07
  it("C-07: admin ve tab bar con Productos y Categorías", () => {
    mockAsAdmin();
    render(<InventoryPage />, { wrapper: makeWrapper() });

    expect(screen.getByRole("button", { name: "Productos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Categorías" })).toBeInTheDocument();
  });

  // C-08
  it("C-08: worker NO ve tab bar", () => {
    mockAsWorker();
    render(<InventoryPage />, { wrapper: makeWrapper() });

    expect(screen.queryByRole("button", { name: "Productos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Categorías" })).not.toBeInTheDocument();
  });

  // C-09
  it("C-09: click en tab Categorías muestra CategoriasTab", () => {
    mockAsAdmin();
    render(<InventoryPage />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole("button", { name: "Categorías" }));

    expect(screen.getByTestId("categorias-tab")).toBeInTheDocument();
  });

  // C-10
  it("C-10: click en tab Categorías oculta la tabla de productos", () => {
    mockAsAdmin();
    render(<InventoryPage />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole("button", { name: "Categorías" }));

    // la barra de búsqueda de productos desaparece
    expect(screen.queryByPlaceholderText("Buscar por nombre o SKU...")).not.toBeInTheDocument();
  });
});

describe("InventoryPage — lista de productos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsAdmin();
  });

  // C-11
  it("C-11: muestra nombre y precio de productos al cargar", async () => {
    setupFetch([PRODUCTO]);
    render(<InventoryPage />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Alimento Premium")).toBeInTheDocument()
    );
    expect(screen.getByText("$10.000")).toBeInTheDocument();
  });

  // C-12
  it("C-12: producto con stock <= stock_minimo muestra badge 'Bajo stock'", async () => {
    setupFetch([PRODUCTO_BAJO_STOCK]);
    render(<InventoryPage />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Snack Perro")).toBeInTheDocument()
    );

    expect(screen.getByText("Bajo stock")).toBeInTheDocument();
  });

  // C-13
  it("C-13: producto con stock > stock_minimo muestra badge 'OK'", async () => {
    setupFetch([PRODUCTO]);
    render(<InventoryPage />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Alimento Premium")).toBeInTheDocument()
    );

    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  // C-15b: producto sin precio muestra badge 'Sin precio' en Estado
  it("C-15b: producto sin precio muestra badge 'Sin precio' en Estado, no 'OK'", async () => {
    const SIN_PRECIO = { ...PRODUCTO, id: "p5", nombre: "Collar", precio: null };
    setupFetch([SIN_PRECIO]);
    render(<InventoryPage />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Collar")).toBeInTheDocument()
    );

    // El badge de Estado tiene data-variant="outline" (vs el span del precio que no lo tiene)
    const badges = screen.getAllByText("Sin precio");
    const estadoBadge = badges.find((el) => el.dataset.variant === "outline");
    expect(estadoBadge).toBeDefined();
    expect(screen.queryByText("OK")).not.toBeInTheDocument();
  });

  // IV-01: producto sin costo muestra badge 'Sin costo'
  it("IV-01: producto sin costo muestra badge 'Sin costo' en Estado", async () => {
    const SIN_COSTO = { ...PRODUCTO, costo: null };
    setupFetch([SIN_COSTO]);
    render(<InventoryPage />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Alimento Premium")).toBeInTheDocument()
    );

    const badges = screen.getAllByText("Sin costo");
    const estadoBadge = badges.find((el) => el.dataset.variant === "outline");
    expect(estadoBadge).toBeDefined();
    expect(screen.queryByText("OK")).not.toBeInTheDocument();
  });

  // C-16: regresión — producto vencido con stock normal NO debe mostrar "OK"
  it("C-16: producto vencido con stock normal muestra 'Vencido' en Estado, no 'OK'", async () => {
    const ayer = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const PRODUCTO_VENCIDO = { ...PRODUCTO, id: "p3", nombre: "Pro Plan 3kg", fecha_vencimiento: ayer };
    setupFetch([PRODUCTO_VENCIDO]);
    render(<InventoryPage />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Pro Plan 3kg")).toBeInTheDocument()
    );

    expect(screen.getByText("Vencido")).toBeInTheDocument();
    expect(screen.queryByText("OK")).not.toBeInTheDocument();
  });

  // C-17: vencido tiene prioridad sobre bajo stock
  it("C-17: producto vencido con bajo stock muestra 'Vencido', no 'Bajo stock'", async () => {
    const ayer = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const VENCIDO_BAJO_STOCK = { ...PRODUCTO, id: "p4", nombre: "Pro Plan 1kg", stock: 2, stock_minimo: 5, fecha_vencimiento: ayer };
    setupFetch([VENCIDO_BAJO_STOCK]);
    render(<InventoryPage />, { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(screen.getByText("Pro Plan 1kg")).toBeInTheDocument()
    );

    expect(screen.getByText("Vencido")).toBeInTheDocument();
    expect(screen.queryByText("Bajo stock")).not.toBeInTheDocument();
  });
});

describe("InventoryPage — formulario de producto", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsAdmin();
    setupFetch();
  });

  // C-14
  it("C-14: '+ Nuevo producto' abre el modal de creación", () => {
    render(<InventoryPage />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole("button", { name: /\+ Nuevo producto/i }));

    expect(screen.getByText("Nuevo producto")).toBeInTheDocument();
  });

  // C-15
  it("C-15: Cancelar en el modal de creación cierra el formulario", () => {
    render(<InventoryPage />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole("button", { name: /\+ Nuevo producto/i }));
    expect(screen.getByText("Nuevo producto")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText("Nuevo producto")).not.toBeInTheDocument();
  });

  // FP-07: crear producto con campos vacíos muestra errores inline
  it("FP-07: crear producto con campos vacíos muestra errores inline", async () => {
    render(<InventoryPage />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole("button", { name: /\+ Nuevo producto/i }));
    expect(screen.getByText("Nuevo producto")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Crear producto/i }));

    await waitFor(() => {
      expect(screen.getByText("El nombre debe tener al menos 2 caracteres")).toBeInTheDocument();
    });
    expect(screen.getByText("El SKU es obligatorio")).toBeInTheDocument();
    expect(screen.getByText("El precio debe ser mayor a 0")).toBeInTheDocument();
  });

  // FP-08: llenar campos requeridos hace desaparecer los errores inline
  it("FP-08: llenar nombre remueve su error inline", async () => {
    render(<InventoryPage />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole("button", { name: /\+ Nuevo producto/i }));
    fireEvent.click(screen.getByRole("button", { name: /Crear producto/i }));

    await waitFor(() => {
      expect(screen.getByText("El nombre debe tener al menos 2 caracteres")).toBeInTheDocument();
    });

    const nombreInput = screen.getByPlaceholderText("Alimento Premium Perro 15kg");
    fireEvent.change(nombreInput, { target: { value: "Alimento Premium" } });

    expect(screen.queryByText("El nombre debe tener al menos 2 caracteres")).not.toBeInTheDocument();
  });

  // FP-09: formulario válido no muestra errores inline
  it("FP-09: formulario válido no muestra errores inline", async () => {
    render(<InventoryPage />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole("button", { name: /\+ Nuevo producto/i }));

    const nombreInput = screen.getByPlaceholderText("Alimento Premium Perro 15kg");
    const skuInput = screen.getByPlaceholderText("PRD-001");
    const precioInput = screen.getByPlaceholderText("19990");

    fireEvent.change(nombreInput, { target: { value: "Alimento Premium" } });
    fireEvent.change(skuInput, { target: { value: "SKU-001" } });
    fireEvent.change(precioInput, { target: { value: "19990" } });

    fireEvent.click(screen.getByRole("button", { name: /Crear producto/i }));

    expect(screen.queryByText("El nombre debe tener al menos 2 caracteres")).not.toBeInTheDocument();
    expect(screen.queryByText("El SKU es obligatorio")).not.toBeInTheDocument();
    expect(screen.queryByText("El precio debe ser mayor a 0")).not.toBeInTheDocument();
  });

  // FP-11: inputs requeridos tienen atributo HTML required
  it("FP-11: inputs requeridos (nombre, sku, precio) tienen required en el DOM", () => {
    render(<InventoryPage />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole("button", { name: /\+ Nuevo producto/i }));

    const nombreInput = screen.getByPlaceholderText("Alimento Premium Perro 15kg");
    const skuInput = screen.getByPlaceholderText("PRD-001");
    const precioInput = screen.getByPlaceholderText("19990");

    expect(nombreInput).toHaveAttribute("required");
    expect(skuInput).toHaveAttribute("required");
    expect(precioInput).toHaveAttribute("required");
  });

  // FP-12: inputs no requeridos NO tienen atributo HTML required
  it("FP-12: inputs opcionales no tienen required en el DOM", () => {
    render(<InventoryPage />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole("button", { name: /\+ Nuevo producto/i }));

    const codigoBarraInput = screen.getByPlaceholderText("7891234567890");
    const costoInput = screen.getByPlaceholderText("12000");

    expect(codigoBarraInput).not.toHaveAttribute("required");
    expect(costoInput).not.toHaveAttribute("required");
  });

  // FP-10: onBlur en campo requerido vacío muestra error
  it("FP-10: onBlur en campo requerido vacío muestra 'Campo obligatorio'", () => {
    render(<InventoryPage />, { wrapper: makeWrapper() });

    fireEvent.click(screen.getByRole("button", { name: /\+ Nuevo producto/i }));

    const nombreInput = screen.getByPlaceholderText("Alimento Premium Perro 15kg");
    fireEvent.focus(nombreInput);
    fireEvent.blur(nombreInput);

    expect(screen.getByText("Campo obligatorio")).toBeInTheDocument();
  });
});

describe("InventoryPage — acciones responsivas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupFetch([PRODUCTO]);
  });

  // C-35: admin ve los 4 botones de acción sin ml-1 (regresión layout responsivo)
  it("C-35: admin ve Editar, Historial, Lotes y Desact. sin ml-1", async () => {
    mockAsAdmin();
    render(<InventoryPage />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Alimento Premium")).toBeInTheDocument());

    const editar = screen.getByText("Editar");
    const historial = screen.getByText("Historial");
    const lotes = screen.getByText("Lotes");
    const desact = screen.getByText("Desact.");

    expect(editar).toBeInTheDocument();
    expect(historial).toBeInTheDocument();
    expect(lotes).toBeInTheDocument();
    expect(desact).toBeInTheDocument();

    expect(editar.classList.contains("ml-1")).toBe(false);
    expect(historial.classList.contains("ml-1")).toBe(false);
    expect(lotes.classList.contains("ml-1")).toBe(false);
    expect(desact.classList.contains("ml-1")).toBe(false);
  });

  // C-36: worker NO ve botones de acción (no tiene columna de acciones)
  it("C-36: worker no ve Editar/Historial/Lotes/Desact.", async () => {
    mockAsWorker();
    render(<InventoryPage />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Alimento Premium")).toBeInTheDocument());

    expect(screen.queryByText("Editar")).not.toBeInTheDocument();
    expect(screen.queryByText("Historial")).not.toBeInTheDocument();
    expect(screen.queryByText("Lotes")).not.toBeInTheDocument();
    expect(screen.queryByText("Desact.")).not.toBeInTheDocument();
  });

  // C-37: Producto cell tiene clase truncate para evitar desbordar la tabla
  it("C-37: nombre de producto tiene clase truncate", async () => {
    mockAsAdmin();
    render(<InventoryPage />, { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText("Alimento Premium")).toBeInTheDocument());

    const cells = screen.getAllByText("Alimento Premium");
    const td = cells[0].closest("td");
    expect(td).toBeTruthy();
    expect(td!.classList.contains("truncate")).toBe(true);
  });
});

// ── Ajuste de stock — regresión robo de foco (Motivo truncado) ────────────────
//
// Bug reportado: el campo "Motivo" del modal de ajuste de stock (y el de
// devolución parcial/NC) guardaba solo 1-2 caracteres del texto ingresado
// (ej. "QA test conteo fisico" → "Q"). Causa raíz real (no una columna
// VARCHAR(1) — se verificó que motivo/notas son TEXT sin límite en el schema):
// ModalOverlay volvía a robar el foco del input en cada re-render porque su
// efecto de foco dependía de `[open, onClose]`, y el modal de ajuste pasa un
// onClose inline (`function() {...}`) que es una referencia NUEVA en cada
// render — corregido en src/components/ui/modal-overlay.tsx (commit 1270b13)
// separando el efecto de foco (ahora solo depende de `[open]`) del efecto que
// sincroniza onCloseRef. Los tests MO-05/MO-06 prueban esto de forma aislada
// en ModalOverlay; estos dos tests prueban el mismo mecanismo end-to-end en
// el consumidor real que el bug reportó afectado.
describe("InventoryPage — ajuste de stock (Motivo)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsAdmin();
    setupFetch([PRODUCTO]);
  });

  // IV-02: el texto completo (con acentos) ingresado en Motivo se envía
  // íntegro en el body del PATCH — no un prefijo truncado.
  it("IV-02: el Motivo completo con acentos se envía íntegro en el body del ajuste", async () => {
    render(<InventoryPage />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText("Alimento Premium")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "+" }));

    const motivoInput = screen.getByPlaceholderText(/conteo físico, devolución, merma/i);
    fireEvent.change(motivoInput, { target: { value: "QA test - devolución Arena Arenero" } });

    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(PRODUCTO) } as Response)
    );

    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    await waitFor(() => {
      const patchCall = (global.fetch as jest.Mock).mock.calls.find(
        ([, opts]: [string, RequestInit]) => opts?.method === "PATCH"
      );
      expect(patchCall).toBeDefined();
    });

    const patchCall = (global.fetch as jest.Mock).mock.calls.find(
      ([, opts]: [string, RequestInit]) => opts?.method === "PATCH"
    )!;
    const body = JSON.parse(patchCall[1].body as string);
    expect(body.notas).toBe("QA test - devolución Arena Arenero");
  });

  // IV-03: REGRESIÓN — re-renderizar mientras el modal de ajuste está abierto
  // (ej. al cambiar Cantidad, que pasa un onClose inline nuevo a ModalOverlay
  // en cada render) NO debe volver a robar el foco. Este test habría fallado
  // contra el ModalOverlay anterior a 1270b13 (focus() se llamaba de nuevo en
  // cada re-render por la dependencia [open, onClose]).
  it("IV-03: REGRESIÓN — cambiar Cantidad no vuelve a robar el foco del modal de ajuste", async () => {
    const focusSpy = jest.spyOn(HTMLElement.prototype, "focus");
    render(<InventoryPage />, { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText("Alimento Premium")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "+" }));
    const llamadasAlAbrir = focusSpy.mock.calls.length;
    expect(llamadasAlAbrir).toBeGreaterThan(0);

    // Forzar un re-render del modal cambiando otro estado del mismo componente
    // (Cantidad) — esto recrea el onClose inline pasado a ModalOverlay.
    const cantidadInput = screen.getByRole("spinbutton");
    fireEvent.change(cantidadInput, { target: { value: "5" } });

    expect(focusSpy).toHaveBeenCalledTimes(llamadasAlAbrir);

    focusSpy.mockRestore();
  });
});
