/**
 * Tests COD-01 a COD-06: CreateOrderDialog
 * - COD-01: renderiza campos requeridos al abrir
 * - COD-02: permite agregar items existentes
 * - COD-03: permite agregar items nuevos (nombre libre)
 * - COD-04: valida que haya al menos un item antes de crear
 * - COD-05: envía POST con items + fecha_estimada + notas
 * - COD-06: limpia el formulario al cerrar
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

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

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
      const { container } = renderDialog(false);
      expect(container.querySelector('[data-testid="dialog"]')).toBeNull();
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
});
