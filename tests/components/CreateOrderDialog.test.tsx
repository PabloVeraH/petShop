/**
 * Tests COD-01 a COD-07: CreateOrderDialog
 * - COD-01: renderiza campos requeridos al abrir
 * - COD-02: permite agregar items existentes
 * - COD-03: permite agregar items nuevos (nombre libre)
 * - COD-04: valida que haya al menos un item antes de crear
 * - COD-05: envía POST con items + fecha_estimada + notas
 * - COD-06: limpia el formulario al cerrar
 * - COD-07: escribir en Notas no pierde caracteres (Dialog real, no mockeado)
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const mockOnClose = jest.fn();
const mockOnOrderCreated = jest.fn();

const PRODUCTOS_MOCK = [
  { id: "prod-1", nombre: "Alimento Premium", sku: "AP-001", precio: 15000 },
  { id: "prod-2", nombre: "Arena Gatitos", sku: "AG-002", precio: 5000 },
];

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children, onClick, disabled,
  }: {
    children: ReactNode; onClick?: () => void; disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

import CreateOrderDialog from "@/components/orders/create-order-dialog";

const renderDialog = (open = true) => {
  return render(
    <CreateOrderDialog
      open={open}
      onClose={mockOnClose}
      proveedorId="prov-001"
      productos={PRODUCTOS_MOCK}
      onOrderCreated={mockOnOrderCreated}
    />
  );
};

describe("CreateOrderDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  describe("COD-01: renderizado", () => {
    it("renderiza el título del diálogo cuando está abierto", () => {
      renderDialog(true);
      expect(screen.getByText("Nueva Orden de Compra")).toBeInTheDocument();
    });

    it("no renderiza nada cuando está cerrado", () => {
      renderDialog(false);
      expect(screen.queryByText("Nueva Orden de Compra")).not.toBeInTheDocument();
    });

    it("muestra campos de fecha estimada y notas", () => {
      renderDialog(true);
      expect(screen.getByText("Fecha estimada de entrega")).toBeInTheDocument();
      expect(screen.getByText("Notas")).toBeInTheDocument();
    });
  });

  describe("COD-02: agregar item existente", () => {
    it("agrega un producto existente a la lista de items", () => {
      renderDialog(true);

      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "prod-1" } });

      const addBtn = screen.getByText("Agregar");
      fireEvent.click(addBtn);

      const itemsEnLista = screen.getAllByText("Alimento Premium").filter(el => el.tagName === "SPAN");
      expect(itemsEnLista[0]).toBeInTheDocument();
      expect(screen.getByText("1x")).toBeInTheDocument();
    });

    it("permite cambiar cantidad antes de agregar", () => {
      renderDialog(true);

      const cantidadInput = screen.getByPlaceholderText("Cant");
      fireEvent.change(cantidadInput, { target: { value: "5" } });

      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "prod-2" } });

      fireEvent.click(screen.getByText("Agregar"));

      expect(screen.getByText("5x")).toBeInTheDocument();
    });
  });

  describe("COD-03: agregar item nuevo", () => {
    it("cambia a modo nuevo producto y agrega con nombre libre", () => {
      renderDialog(true);

      fireEvent.click(screen.getByText("+ Nuevo producto"));

      const input = screen.getByPlaceholderText("Nombre del producto nuevo");
      fireEvent.change(input, { target: { value: "Hueso Gigante" } });

      fireEvent.click(screen.getByText("Agregar"));

      expect(screen.getByText("Hueso Gigante")).toBeInTheDocument();
      expect(screen.getByText("(nuevo)")).toBeInTheDocument();
    });
  });

  describe("COD-04: validación antes de crear", () => {
    it("botón Crear OC está deshabilitado sin items", () => {
      renderDialog(true);

      const createBtn = screen.getByText("Crear OC");
      expect(createBtn).toBeDisabled();
    });
  });

  describe("COD-05: envío de POST", () => {
    it("envía POST con items y fecha_estimada", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "oc-001" }) });

      renderDialog(true);

      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "prod-1" } });
      fireEvent.click(screen.getByText("Agregar"));

      const fechaInput = screen.getAllByDisplayValue("")[0];
      fireEvent.change(fechaInput, { target: { value: "2026-07-15" } });

      fireEvent.click(screen.getByText("Crear OC"));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/ordenes-compra", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining("proveedor_id"),
        });
      });

      const callBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callBody.proveedor_id).toBe("prov-001");
      expect(callBody.items).toHaveLength(1);
      expect(callBody.items[0].producto_id).toBe("prod-1");
      expect(callBody.items[0].cantidad_solicitada).toBe(1);
      expect(callBody.fecha_estimada).toBeDefined();
    });

    it("envía POST con notas", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "oc-002" }) });

      renderDialog(true);

      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "prod-1" } });
      fireEvent.click(screen.getByText("Agregar"));

      const notasTextarea = screen.getByPlaceholderText("Notas opcionales para la orden...");
      fireEvent.change(notasTextarea, { target: { value: "Urgente" } });

      fireEvent.click(screen.getByText("Crear OC"));

      await waitFor(() => {
        const callBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(callBody.notas).toBe("Urgente");
      });
    });

    it("llama onOrderCreated y onClose al crear exitosamente", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ id: "oc-003" }) });

      renderDialog(true);

      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "prod-2" } });
      fireEvent.click(screen.getByText("Agregar"));

      fireEvent.click(screen.getByText("Crear OC"));

      await waitFor(() => {
        expect(mockOnOrderCreated).toHaveBeenCalledTimes(1);
        expect(mockOnClose).toHaveBeenCalledTimes(1);
      });
    });

    it("muestra error si el POST falla", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Stock insuficiente" }),
      });

      renderDialog(true);

      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "prod-1" } });
      fireEvent.click(screen.getByText("Agregar"));

      fireEvent.click(screen.getByText("Crear OC"));

      await waitFor(() => {
        expect(screen.getByText("Stock insuficiente")).toBeInTheDocument();
      });

      expect(mockOnOrderCreated).not.toHaveBeenCalled();
    });
  });

  describe("COD-06: limpieza al cerrar", () => {
    it("limpia items y fecha cuando se abre el diálogo", async () => {
      const { rerender } = render(
        <CreateOrderDialog
          open={true}
          onClose={mockOnClose}
          proveedorId="prov-001"
          productos={PRODUCTOS_MOCK}
          onOrderCreated={mockOnOrderCreated}
        />
      );

      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "prod-1" } });
      fireEvent.click(screen.getByText("Agregar"));

      const fechaInput = screen.getAllByDisplayValue("")[0];
      fireEvent.change(fechaInput, { target: { value: "2026-07-15" } });

      const itemsConPremium = screen.getAllByText("Alimento Premium").filter(el => el.tagName === "SPAN");
      expect(itemsConPremium[0]).toBeInTheDocument();

      // Cerrar (open=false → mock no renderiza)
      rerender(
        <CreateOrderDialog
          open={false}
          onClose={mockOnClose}
          proveedorId="prov-001"
          productos={PRODUCTOS_MOCK}
          onOrderCreated={mockOnOrderCreated}
        />
      );

      // Reabrir (open=true → useEffect resetea el formulario)
      rerender(
        <CreateOrderDialog
          open={true}
          onClose={mockOnClose}
          proveedorId="prov-001"
          productos={PRODUCTOS_MOCK}
          onOrderCreated={mockOnOrderCreated}
        />
      );

      // No debe mostrar items anteriores
      const spansPremium = screen.queryAllByText("Alimento Premium").filter(el => el.tagName === "SPAN");
      expect(spansPremium).toHaveLength(0);
      expect(screen.getByText("Sin productos aún")).toBeInTheDocument();

      // Fecha debe estar vacía
      const dateInputs = screen.getAllByDisplayValue("") as HTMLInputElement[];
      expect(dateInputs.some(el => el.type === "date")).toBe(true);
    });
  });

  // COD-07: investigado a raíz del ticket Trello 6a62eb1e35946ffc7c2a818b
  // ("Motivo trunca a 1 carácter"). Ese bug era del ModalOverlay custom (fix
  // en commit 1270b13, ver DV-17/IV-03/LP-01) — CreateOrderDialog usa el
  // Dialog real de @base-ui/react, una implementación completamente
  // distinta, sin el efecto de foco propenso al bug. No se encontró
  // mecanismo equivalente acá, pero el campo Notas no tenía ningún test que
  // ejercitara un re-render real mientras se escribe (COD-05 solo hace un
  // fireEvent.change con el valor final de una vez). Este test usa el Dialog
  // real (ya no mockeado en este archivo, ver arriba) y dispara varios
  // re-renders sucesivos mientras se escribe, verificando que ninguno
  // pierde caracteres ni vuelve a robar el foco.
  describe("COD-07: escribir en Notas (Dialog real)", () => {
    it("COD-07: escribir en Notas letra por letra no pierde caracteres ni roba el foco", () => {
      const focusSpy = jest.spyOn(HTMLElement.prototype, "focus");
      renderDialog(true);
      const llamadasAlAbrir = focusSpy.mock.calls.length;

      const notasTextarea = screen.getByPlaceholderText("Notas opcionales para la orden...");
      const texto = "QA test - devolución Arena Arenero";
      let acumulado = "";
      for (const char of texto) {
        acumulado += char;
        fireEvent.change(notasTextarea, { target: { value: acumulado } });
      }

      expect(notasTextarea).toHaveValue(texto);
      expect(focusSpy).toHaveBeenCalledTimes(llamadasAlAbrir);

      focusSpy.mockRestore();
    });
  });
});
