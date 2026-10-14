/**
 * Tests CD-11 a CD-16: ClienteDetalle — edición de cliente y mascotas, errores
 * de la API en pantalla, fidelización con próximo nivel y alta de mascota.
 * Fetch enrutado por URL; ModalMascotaCreate es un stub que dispara sus
 * callbacks (tiene sus propios tests).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

jest.mock("@/app/(app)/customers/components/ModalMascotaCreate", () => ({
  __esModule: true,
  default: ({ onCreated, onClose, existingNames }: { onCreated: (m: unknown) => void; onClose: () => void; existingNames: string[] }) => (
    <div>
      <span>modal-mascota: {existingNames.join(",")}</span>
      <button onClick={() => onCreated({ id: "m9", nombre: "Toby", tipo: "perro" })}>stub-crear</button>
      <button onClick={onClose}>stub-cerrar</button>
    </div>
  ),
}));

import ClienteDetalle from "@/app/(app)/customers/components/ClienteDetalle";

const CLIENTE = { id: "c1", store_id: "s1", rut: "11.111.111-1", nombre: "Juan Pérez", email: "juan@test.cl", telefono: "+56911111111" };
const MASCOTAS = [
  { id: "m1", nombre: "Grizzly", tipo: "perro", raza: "Shitsue", peso_kg: 8, gramos_porcion: 25, veces_dia: 3 },
  { id: "m2", nombre: "Luna", tipo: "gato", raza: null, peso_kg: null, gramos_porcion: null, veces_dia: null },
];
const DETALLE = {
  ...CLIENTE,
  mascotas: MASCOTAS,
  ventas: [{ id: "v1", total: 12990, metodo_pago: null, created_at: "2026-05-01T12:00:00Z" }],
  saldo_disponible: 0,
};

let fallos: Record<string, { error?: string }> = {};
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  fallos = {};
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const clave = `${init?.method ?? "GET"} ${url}`;
    if (fallos[clave]) return { ok: false, json: async () => fallos[clave] };
    if (url.startsWith("/api/fidelizacion")) {
      return { ok: true, json: async () => ({ total_historico: 30000, frecuencia_compras: 2, descuento_actual: 5, niveles: [{ monto: 100000, descuento: 10 }, { monto: 20000, descuento: 5 }] }) };
    }
    if (init?.method && init.method !== "GET") return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => DETALLE };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

function renderDetalle() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  render(<ClienteDetalle cliente={CLIENTE as never} onRefresh={jest.fn()} />, { wrapper: Wrapper });
}

const llamadas = (metodo: string, url: string) => fetchMock.mock.calls.filter(([u, i]) => u === url && (i?.method ?? "GET") === metodo);

describe("ClienteDetalle — edición", () => {
  it("CD-11: editar cliente: RUT inválido no llama a la API; RUT se autoformatea; error del servidor se muestra; OK hace PATCH", async () => {
    renderDetalle();
    fireEvent.click((await screen.findAllByRole("button", { name: "Editar" }))[0]);

    const rut = screen.getByPlaceholderText("11.111.111-1");
    fireEvent.change(rut, { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByText("RUT inválido")).toBeInTheDocument();
    expect(llamadas("PATCH", "/api/clientes/c1")).toHaveLength(0);

    fireEvent.change(rut, { target: { value: "111111111" } });
    expect(rut).toHaveValue("11.111.111-1");
    const [, nombre, email, telefono] = screen.getAllByRole("textbox");
    fireEvent.change(nombre, { target: { value: "Juan P." } });
    fireEvent.change(email, { target: { value: "jp@test.cl" } });
    fireEvent.change(telefono, { target: { value: "+56922222222" } });

    fallos["PATCH /api/clientes/c1"] = { error: "Email ya usado" };
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Email ya usado")).toBeInTheDocument();

    delete fallos["PATCH /api/clientes/c1"];
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(llamadas("PATCH", "/api/clientes/c1")).toHaveLength(2));
    expect(JSON.parse(llamadas("PATCH", "/api/clientes/c1")[1][1].body)).toEqual({
      rut: "11.111.111-1", nombre: "Juan P.", email: "jp@test.cl", telefono: "+56922222222",
    });
    await waitFor(() => expect(screen.queryByPlaceholderText("11.111.111-1")).not.toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByPlaceholderText("11.111.111-1")).not.toBeInTheDocument();
  });

  it("CD-12: editar mascota: nombre duplicado se rechaza sin llamar; luego PATCH con números convertidos", async () => {
    renderDetalle();
    await screen.findByText("Luna");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[1]);

    const inputs = () => screen.getAllByRole("textbox");
    fireEvent.change(inputs()[0], { target: { value: "luna" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Ya existe una mascota con ese nombre para este cliente")).toBeInTheDocument();
    expect(llamadas("PATCH", "/api/mascotas/m1")).toHaveLength(0);

    fireEvent.change(inputs()[0], { target: { value: "Grizzly II" } });
    fireEvent.change(screen.getByPlaceholderText("perro / gato / otro"), { target: { value: "perro" } });
    fireEvent.change(inputs()[2], { target: { value: "Mestizo" } });
    const [peso, gramos, veces] = screen.getAllByRole("spinbutton");
    fireEvent.change(peso, { target: { value: "9.5" } });
    fireEvent.change(gramos, { target: { value: "" } });
    fireEvent.change(veces, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(llamadas("PATCH", "/api/mascotas/m1")).toHaveLength(1));
    expect(JSON.parse(llamadas("PATCH", "/api/mascotas/m1")[0][1].body)).toEqual({
      nombre: "Grizzly II", tipo: "perro", raza: "Mestizo", peso_kg: 9.5, veces_dia: 2,
    });
  });

  it("CD-13: error del PATCH de mascota se muestra; Cancelar sale de la edición", async () => {
    fallos["PATCH /api/mascotas/m2"] = {};
    renderDetalle();
    await screen.findByText("Luna");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[2]);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Error al guardar")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByPlaceholderText("perro / gato / otro")).not.toBeInTheDocument();
  });

  it("CD-14: eliminar mascota con error de la API muestra el mensaje; Cancelar descarta la confirmación", async () => {
    fallos["DELETE /api/mascotas/m1"] = { error: "Tiene ventas asociadas" };
    renderDetalle();
    await screen.findByText("Grizzly");
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Sí, eliminar" }));
    expect(await screen.findByText("Tiene ventas asociadas")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText("¿Eliminar esta mascota?")).not.toBeInTheDocument();
  });
});

describe("ClienteDetalle — fidelización y alta de mascota", () => {
  it("CD-15: fidelización muestra descuento actual y lo que falta para el próximo nivel; compra sin método muestra 'efectivo'", async () => {
    renderDetalle();
    expect(await screen.findByText("5% descuento")).toBeInTheDocument();
    expect(screen.getByText("Próximo nivel: $70.000 para 10%")).toBeInTheDocument();
    expect(screen.getByText(/efectivo/)).toBeInTheDocument();
    expect(screen.getByText("· 25g × 3/día")).toBeInTheDocument();
  });

  it("CD-16: + Agregar abre el alta con los nombres existentes; la mascota creada aparece en la lista; cerrar refresca", async () => {
    renderDetalle();
    await screen.findByText("Grizzly");
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar" }));
    expect(screen.getByText("modal-mascota: Grizzly,Luna")).toBeInTheDocument();

    fireEvent.click(screen.getByText("stub-crear"));
    expect(await screen.findByText("Toby")).toBeInTheDocument();

    const antes = llamadas("GET", "/api/clientes/c1").length;
    fireEvent.click(screen.getByText("stub-cerrar"));
    await waitFor(() => expect(llamadas("GET", "/api/clientes/c1").length).toBeGreaterThan(antes));
    expect(screen.queryByText(/modal-mascota/)).not.toBeInTheDocument();
  });
});
