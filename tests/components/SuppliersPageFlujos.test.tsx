/**
 * Tests SPF-01 a SPF-12: SupplierHubPage con TanStack Query real.
 *
 * SuppliersPage.test.tsx mockea useMutation (las mutationFn nunca corren):
 * aquí cada botón dispara la request real y se verifica URL, método y body,
 * más los mensajes de validación y de error que llegan a pantalla.
 * Los diálogos de OC (crear / editar ítems) se reemplazan por stubs: tienen
 * sus propios tests; aquí solo importa lo que la página hace con sus callbacks.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockWriteFile = jest.fn();
jest.mock("xlsx", () => ({
  utils: { json_to_sheet: jest.fn(() => ({})), book_new: jest.fn(() => ({})), book_append_sheet: jest.fn() },
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

jest.mock("@/components/orders/create-order-dialog", () => ({
  __esModule: true,
  default: ({ onOrderCreated, onClose }: { onOrderCreated: () => void; onClose: () => void }) => (
    <div>
      <span>dialogo-crear-oc</span>
      <button onClick={() => { onOrderCreated(); onClose(); }}>stub-crear-oc</button>
    </div>
  ),
}));
jest.mock("@/components/orders/edit-order-items-dialog", () => ({
  __esModule: true,
  default: ({ onOrderEdited, onClose }: { onOrderEdited: () => void; onClose: () => void }) => (
    <div>
      <span>dialogo-editar-items</span>
      <button onClick={onOrderEdited}>stub-guardar-items</button>
      <button onClick={onClose}>stub-cerrar-items</button>
    </div>
  ),
}));

import SupplierHubPage from "@/app/(app)/suppliers/page";

function fecha(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PROV = { id: "p1", nombre: "Distribuidora Uno", rut: "76.111.111-1", contacto: "Ana", telefono: "+569", email: "a@uno.cl" };
const ORDENES = [
  { id: "oc-pend", numero: "OC-PEND", estado: "pendiente", total: 0, fecha_estimada: null, fecha_recibida: null, created_at: "" },
  { id: "oc-env", numero: "OC-ENV", estado: "enviada", total: 30000, fecha_estimada: null, fecha_recibida: null, created_at: "" },
  { id: "oc-rec", numero: "OC-REC", estado: "recibida", total: 10000, fecha_estimada: "2026-01-10", fecha_recibida: "2026-01-09", created_at: "" },
];
const CUENTAS = [
  { id: "cp-venc", monto: 1000, fecha_vencimiento: fecha(-3), estado: "pendiente" },
  { id: "cp-pronto", monto: 2000, fecha_vencimiento: fecha(3), estado: "pendiente" },
  { id: "cp-lejos", monto: 4000, fecha_vencimiento: fecha(20), estado: "pendiente" },
];
const ITEMS_ENV = [
  { id: "it-1", cantidad_solicitada: 5, cantidad_recibida: null, precio_unitario: null, nombre_nuevo: null, productos: { id: "prod-1", nombre: "Alimento", sku: "A1", tiene_vencimiento: true } },
  { id: "it-2", cantidad_solicitada: 2, cantidad_recibida: null, precio_unitario: null, nombre_nuevo: "Juguete nuevo", productos: null },
];

type Respuesta = { ok?: boolean; body: unknown };
let fallos: Record<string, Respuesta> = {};
const fetchMock = jest.fn();

function responder(url: string, init?: RequestInit): Respuesta {
  const metodo = init?.method ?? "GET";
  const clave = `${metodo} ${url}`;
  if (fallos[clave]) return fallos[clave];
  if (metodo !== "GET") return { body: url.includes("/api/proveedores/") ? { ...PROV, nombre: "Renombrado" } : { ok: true } };
  if (url.startsWith("/api/proveedores?search=")) return { body: [PROV] };
  if (url === "/api/proveedores/stats") return { body: { orderCounts: { p1: 2 }, payableCounts: { p1: 3 }, payableAmounts: { p1: 7000 } } };
  if (url === "/api/proveedores/p1") return { body: { ...PROV, productos: [{ id: "pp-1", costo: 1500, tiempo_entrega_dias: 3, productos: { id: "prod-1", nombre: "Alimento", sku: "A1", stock: 8 } }] } };
  if (url.startsWith("/api/ordenes-compra/")) {
    const id = url.split("/").pop()!;
    return { body: { ...ORDENES.find((o) => o.id === id), items: id === "oc-env" ? ITEMS_ENV : [ITEMS_ENV[0]] } };
  }
  if (url.startsWith("/api/ordenes-compra")) return { body: ORDENES };
  if (url.startsWith("/api/cuentas-pagar")) return { body: CUENTAS };
  if (url.startsWith("/api/inventario")) return { body: [{ id: "prod-9", nombre: "Arena", sku: "AR", precio: 3000 }] };
  return { body: [] };
}

function llamadas(metodo: string, prefijo: string) {
  return fetchMock.mock.calls.filter(([u, i]) => (i?.method ?? "GET") === metodo && String(u).startsWith(prefijo));
}

async function renderPagina() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><SupplierHubPage /></QueryClientProvider>);
  await screen.findByText("Distribuidora Uno");
}

async function seleccionar() {
  fireEvent.click(screen.getByText("Distribuidora Uno"));
  await screen.findByText("RUT: 76.111.111-1");
}

async function expandir(numero: string) {
  fireEvent.click(await screen.findByText(numero));
}

beforeEach(() => {
  jest.clearAllMocks();
  fallos = {};
  localStorage.clear();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const r = responder(url, init);
    return { ok: r.ok ?? true, json: async () => r.body };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("SupplierHubPage — proveedores", () => {
  it("SPF-01: crear proveedor exige nombre; con nombre hace POST /api/proveedores con el formulario", async () => {
    await renderPagina();
    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByText("Nombre requerido")).toBeInTheDocument();
    expect(llamadas("POST", "/api/proveedores")).toHaveLength(0);

    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "Nuevo Prov" } });
    fireEvent.change(inputs[1], { target: { value: "11.111.111-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(llamadas("POST", "/api/proveedores")).toHaveLength(1));
    expect(JSON.parse(llamadas("POST", "/api/proveedores")[0][1].body)).toEqual(
      expect.objectContaining({ nombre: "Nuevo Prov", rut: "11.111.111-1" })
    );
    await waitFor(() => expect(screen.queryByText("Nombre requerido")).not.toBeInTheDocument());
  });

  it("SPF-02: si el POST falla, el error del servidor se muestra en el formulario", async () => {
    fallos["POST /api/proveedores"] = { ok: false, body: { error: "RUT duplicado" } };
    await renderPagina();
    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo" }));
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("RUT duplicado")).toBeInTheDocument();
  });

  it("SPF-03: editar hace PATCH /api/proveedores/p1 con los datos cargados; error se muestra; cancelar vuelve a la ficha", async () => {
    await renderPagina();
    await seleccionar();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const nombre = screen.getAllByRole("textbox").find((i) => (i as HTMLInputElement).value === "Distribuidora Uno")!;
    fireEvent.change(nombre, { target: { value: "Renombrado" } });

    fallos["PATCH /api/proveedores/p1"] = { ok: false, body: { error: "Sin permiso" } };
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Sin permiso")).toBeInTheDocument();

    delete fallos["PATCH /api/proveedores/p1"];
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(llamadas("PATCH", "/api/proveedores/p1")).toHaveLength(2));
    expect(JSON.parse(llamadas("PATCH", "/api/proveedores/p1")[1][1].body)).toEqual(
      expect.objectContaining({ nombre: "Renombrado", rut: "76.111.111-1", email: "a@uno.cl" })
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Cancelar" })[0]);
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
  });

  it("SPF-04: eliminar hace DELETE /api/proveedores?id=p1 y vuelve al estado sin selección", async () => {
    await renderPagina();
    await seleccionar();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(llamadas("DELETE", "/api/proveedores?id=p1")).toHaveLength(1));
    expect(await screen.findByText("Selecciona un proveedor")).toBeInTheDocument();
  });

  it("SPF-05: buscar consulta /api/proveedores con el término", async () => {
    await renderPagina();
    fireEvent.change(screen.getByPlaceholderText("Buscar proveedor..."), { target: { value: "uno" } });
    await waitFor(() => expect(llamadas("GET", "/api/proveedores?search=uno")).toHaveLength(1));
  });

  it("SPF-06: agregar producto hace POST /api/proveedor-productos con proveedor_id; ✕ hace DELETE", async () => {
    await renderPagina();
    await seleccionar();
    expect(screen.getByText("Alimento")).toBeInTheDocument();
    expect(screen.getByText(/\$1\.500 · 3d · Stock: 8/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ Agregar" }));
    const agregar = screen.getByRole("button", { name: "Agregar" });
    expect(agregar).toBeDisabled();
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "prod-9" } });
    await screen.findByRole("option", { name: "Arena (AR)" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "prod-9" } });
    const [costo, dias] = screen.getAllByRole("spinbutton");
    fireEvent.change(costo, { target: { value: "2500" } });
    fireEvent.change(dias, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    await waitFor(() => expect(llamadas("POST", "/api/proveedor-productos")).toHaveLength(1));
    expect(JSON.parse(llamadas("POST", "/api/proveedor-productos")[0][1].body)).toEqual({
      proveedor_id: "p1", producto_id: "prod-9", costo: "2500", tiempo_entrega_dias: "5",
    });

    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    await waitFor(() => expect(llamadas("DELETE", "/api/proveedor-productos?id=pp-1")).toHaveLength(1));
  });

  it("SPF-07: badge de cumplimiento con OC recibidas a tiempo", async () => {
    await renderPagina();
    await seleccionar();
    expect(screen.getByText("100% on-time")).toBeInTheDocument();
    expect(screen.getByText("2 OC pendientes")).toBeInTheDocument();
    expect(screen.getByText("$7.000 x pagar")).toBeInTheDocument();
  });
});

describe("SupplierHubPage — órdenes de compra", () => {
  it("SPF-08: OC pendiente: Enviar OC y Cancelar OC hacen PATCH con el estado; Editar items abre el diálogo y al guardar refresca", async () => {
    await renderPagina();
    await seleccionar();
    await expandir("OC-PEND");
    expect(await screen.findByText("Precio pendiente")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Enviar OC" }));
    await waitFor(() => expect(llamadas("PATCH", "/api/ordenes-compra/oc-pend")).toHaveLength(1));
    expect(JSON.parse(llamadas("PATCH", "/api/ordenes-compra/oc-pend")[0][1].body)).toEqual({ estado: "enviada" });

    await expandir("OC-PEND");
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar OC" }));
    await waitFor(() => expect(llamadas("PATCH", "/api/ordenes-compra/oc-pend")).toHaveLength(2));
    expect(JSON.parse(llamadas("PATCH", "/api/ordenes-compra/oc-pend")[1][1].body)).toEqual({ estado: "cancelada" });

    await expandir("OC-PEND");
    fireEvent.click(await screen.findByRole("button", { name: "Editar items" }));
    expect(await screen.findByText("dialogo-editar-items")).toBeInTheDocument();
    fireEvent.click(screen.getByText("stub-guardar-items"));
    await waitFor(() => expect(screen.queryByText("dialogo-editar-items")).not.toBeInTheDocument());
  });

  it("SPF-09: OC enviada: cancelar pide confirmación (Volver no llama); Confirmar cancelación notifica al proveedor", async () => {
    await renderPagina();
    await seleccionar();
    await expandir("OC-ENV");
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar OC" }));
    expect(screen.getByText("¿Cancelar esta orden de compra?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Volver" }));
    expect(screen.queryByText("¿Cancelar esta orden de compra?")).not.toBeInTheDocument();
    expect(llamadas("PATCH", "/api/ordenes-compra/oc-env")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar OC" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    await waitFor(() => expect(llamadas("PATCH", "/api/ordenes-compra/oc-env")).toHaveLength(1));
    expect(JSON.parse(llamadas("PATCH", "/api/ordenes-compra/oc-env")[0][1].body)).toEqual({ estado: "cancelada", notificar_proveedor: true });
  });

  it("SPF-10: recibir OC valida precio y vencimiento antes de enviar; luego PATCH action=recibir con los ítems", async () => {
    await renderPagina();
    await seleccionar();
    await expandir("OC-ENV");
    expect(await screen.findByText("(nuevo)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recibir OC" }));

    fireEvent.click(screen.getByRole("button", { name: "Confirmar recepción" }));
    expect(screen.getByText("Precio unitario requerido: Alimento, Juguete nuevo")).toBeInTheDocument();

    const recepcion = screen.getByText(/Confirmar recepción — ingrese/).parentElement!;
    const precios = within(recepcion).getAllByPlaceholderText("0");
    fireEvent.change(precios[0], { target: { value: "1000" } });
    fireEvent.change(precios[1], { target: { value: "500" } });
    const cantidades = within(recepcion).getAllByRole("spinbutton").filter((i) => i.getAttribute("placeholder") !== "0");
    fireEvent.change(cantidades[1], { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar recepción" }));
    expect(screen.getByText("Fecha de vencimiento requerida: Alimento")).toBeInTheDocument();

    const fechaInput = recepcion.querySelector('input[type="date"]')!;
    fireEvent.change(fechaInput, { target: { value: "2027-01-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar recepción" }));

    await waitFor(() => expect(llamadas("PATCH", "/api/ordenes-compra/oc-env")).toHaveLength(1));
    expect(JSON.parse(llamadas("PATCH", "/api/ordenes-compra/oc-env")[0][1].body)).toEqual({
      action: "recibir",
      items: [
        { id: "it-1", cantidad_recibida: 5, precio_unitario: 1000, producto_id: "prod-1", fecha_vencimiento: "2027-01-31" },
        { id: "it-2", cantidad_recibida: 1, precio_unitario: 500, nombre_nuevo: "Juguete nuevo" },
      ],
    });
  });

  it("SPF-11: + Nueva OC abre el diálogo y al crear vuelve a pedir las órdenes", async () => {
    await renderPagina();
    await seleccionar();
    const antes = llamadas("GET", "/api/ordenes-compra?proveedor_id=p1").length;
    fireEvent.click(screen.getByRole("button", { name: "+ Nueva OC" }));
    fireEvent.click(await screen.findByText("stub-crear-oc"));
    await waitFor(() => expect(llamadas("GET", "/api/ordenes-compra?proveedor_id=p1").length).toBeGreaterThan(antes));
    expect(screen.queryByText("dialogo-crear-oc")).not.toBeInTheDocument();
  });
});

describe("SupplierHubPage — cuentas por pagar", () => {
  it("SPF-12: filtros por vencimiento, guardar/cargar/borrar filtro, pago múltiple con error parcial y exportar", async () => {
    await renderPagina();
    await seleccionar();
    expect(screen.getByText("Cuentas por Pagar (3)")).toBeInTheDocument();
    expect(screen.getByText(/VENCIDA/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Vencidas" }));
    expect(screen.getByText("Cuentas por Pagar (1)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Próx. a vencer" }));
    expect(screen.getByText("Cuentas por Pagar (1)")).toBeInTheDocument();
    expect(screen.getByText(/3 días/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Esta semana" }));
    expect(screen.getByText("Cuentas por Pagar (1)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "💾" }));
    expect(JSON.parse(localStorage.getItem("supply-chain-saved-filters")!)).toEqual([
      expect.objectContaining({ type: "due-this-week" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Todas" }));
    expect(screen.getByText("Cuentas por Pagar (3)")).toBeInTheDocument();
    const guardado = screen.getByRole("button", { name: /⭐ Filtro/ });
    fireEvent.click(guardado);
    expect(screen.getByText("Cuentas por Pagar (1)")).toBeInTheDocument();
    fireEvent.click(within(guardado.parentElement!).getByRole("button", { name: "✕" }));
    expect(JSON.parse(localStorage.getItem("supply-chain-saved-filters")!)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Todas" }));
    const checks = screen.getAllByRole("checkbox");
    fireEvent.click(checks[0]);
    fireEvent.click(checks[1]);
    fireEvent.click(checks[2]);
    fireEvent.click(checks[2]);

    fireEvent.click(screen.getByRole("button", { name: "Exportar 2" }));
    expect(mockWriteFile).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^pagos-Distribuidora Uno-/));

    fallos["PATCH /api/cuentas-pagar?id=cp-pronto"] = { ok: false, body: { error: "Ya pagada" } };
    fireEvent.click(screen.getByRole("button", { name: "Pagar 2" }));
    expect(screen.getByText("2 cuentas seleccionadas")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Efectivo"), { target: { value: "transferencia" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));

    expect(await screen.findByText("1 pago(s) fallaron: Ya pagada")).toBeInTheDocument();
    expect(llamadas("PATCH", "/api/cuentas-pagar")).toHaveLength(2);
    expect(JSON.parse(llamadas("PATCH", "/api/cuentas-pagar")[0][1].body)).toEqual({ estado: "pagada", metodo_pago: "transferencia" });

    delete fallos["PATCH /api/cuentas-pagar?id=cp-pronto"];
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));
    await waitFor(() => expect(screen.queryByText("Confirmar pago", { selector: "h3" })).not.toBeInTheDocument());
  });

  it("SPF-13: pago individual con error muestra el mensaje; Escape/Cancelar cierran sin pagar", async () => {
    fallos["PATCH /api/cuentas-pagar?id=cp-venc"] = { ok: false, body: {} };
    await renderPagina();
    await seleccionar();
    fireEvent.click(screen.getAllByRole("button", { name: "Pagar" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));
    expect(await screen.findByText("Error al procesar el pago")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Método de pago")).not.toBeInTheDocument());
  });
});
