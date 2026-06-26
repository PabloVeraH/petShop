/**
 * Tests EOI-01 a EOI-06: EditOrderItemsDialog
 * - EOI-01: renderiza campos y pre-carga items existentes
 * - EOI-02: permite agregar items adicionales
 * - EOI-03: permite eliminar items existentes
 * - EOI-04: valida que haya al menos un item antes de guardar
 * - EOI-05: envía PATCH action=edit_items con items actualizados
 * - EOI-06: muestra error si el PATCH falla
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const mockOnClose = jest.fn();
const mockOnOrderEdited = jest.fn();

const PRODUCTOS_MOCK = [
  { id: "prod-1", nombre: "Alimento Premium", sku: "AP-001", precio: 15000 },
  { id: "prod-2", nombre: "Arena Gatitos", sku: "AG-002", precio: 5000 },
];

const EXISTING_ITEMS = [
  {
    id: "item-1",
    cantidad_solicitada: 10,
    nombre_nuevo: null,
    productos: { id: "prod-1", nombre: "Alimento Premium" },
  },
  {
    id: "item-2",
    cantidad_solicitada: 5,
    nombre_nuevo: "Hueso Gigante",
    productos: null,
  },
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

import EditOrderItemsDialog from "@/components/orders/edit-order-items-dialog";

const renderDialog = (open = true) => {
  return render(
    <EditOrderItemsDialog
      open={open}
      onClose={mockOnClose}
      ordenId="oc-001"
      productos={PRODUCTOS_MOCK}
      existingItems={EXISTING_ITEMS}
      onOrderEdited={mockOnOrderEdited}
    />
  );
};

describe("EditOrderItemsDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  describe("EOI-01: renderizado con items existentes", () => {
    it("muestra el título y los items pre-cargados", () => {
      renderDialog(true);

      expect(screen.getByText("Editar Items de la OC")).toBeInTheDocument();

      // Debe mostrar los items existentes (en la lista, no en el selector)
      const alimentoSpans = screen.getAllByText("Alimento Premium").filter(el => el.tagName === "SPAN");
      expect(alimentoSpans[0]).toBeInTheDocument();
      expect(screen.getByText("10x")).toBeInTheDocument();

      // Item nuevo también debe aparecer
      expect(screen.getByText("Hueso Gigante")).toBeInTheDocument();
      expect(screen.getByText("(nuevo)")).toBeInTheDocument();
      expect(screen.getByText("5x")).toBeInTheDocument();

      // Botón Guardar debe estar habilitado (hay items)
      expect(screen.getByText("Guardar cambios")).not.toBeDisabled();
    });
  });

  describe("EOI-02: agregar items adicionales", () => {
    it("permite agregar un producto existente adicional", () => {
      renderDialog(true);

      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "prod-2" } });

      fireEvent.click(screen.getByText("Agregar"));

      // Ahora debe tener 3 items
      const arenaSpans = screen.getAllByText("Arena Gatitos").filter(el => el.tagName === "SPAN");
      expect(arenaSpans[0]).toBeInTheDocument();
    });

    it("permite agregar un producto nuevo", () => {
      renderDialog(true);

      fireEvent.click(screen.getByText("+ Nuevo producto"));

      const input = screen.getByPlaceholderText("Nombre del producto nuevo");
      fireEvent.change(input, { target: { value: "Collar Perro" } });

      fireEvent.click(screen.getByText("Agregar"));

      expect(screen.getByText("Collar Perro")).toBeInTheDocument();
      expect(screen.getAllByText("(nuevo)").length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("EOI-03: eliminar items existentes", () => {
    it("elimina un item de la lista al hacer clic en ✕", () => {
      renderDialog(true);

      // Debería haber 2 items inicialmente (filtrar solo <span> para evitar el <option>)
      const alimentoSpans = screen.getAllByText("Alimento Premium").filter(el => el.tagName === "SPAN");
      expect(alimentoSpans[0]).toBeInTheDocument();

      // Eliminar todos los items haciendo clic en ✕
      const removeButtons = screen.getAllByText("✕");
      fireEvent.click(removeButtons[0]);

      // Alimento Premium debería desaparecer (ningún <span> con ese texto)
      const alimentoSpansAfter = screen.queryAllByText("Alimento Premium").filter(el => el.tagName === "SPAN");
      expect(alimentoSpansAfter).toHaveLength(0);
    });
  });

  describe("EOI-04: validación antes de guardar", () => {
    it("botón Guardar cambios está deshabilitado si no hay items", () => {
      renderDialog(true);

      // Eliminar items uno por uno (re-query tras cada click por re-render)
      const removeBtn0 = screen.getAllByText("✕")[0];
      fireEvent.click(removeBtn0);

      const removeBtn1 = screen.getAllByText("✕")[0];
      fireEvent.click(removeBtn1);

      // Después de eliminar ambos, no debe haber items
      expect(screen.getByText("Guardar cambios")).toBeDisabled();
    });
  });

  describe("EOI-05: envío de PATCH", () => {
    it("envía PATCH con action=edit_items y los items actualizados", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

      renderDialog(true);

      // Agregar un item adicional
      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "prod-2" } });
      fireEvent.click(screen.getByText("Agregar"));

      fireEvent.click(screen.getByText("Guardar cambios"));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/ordenes-compra/oc-001", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining("edit_items"),
        });
      });

      const callBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callBody.action).toBe("edit_items");
      expect(callBody.items).toHaveLength(3); // 2 existentes + 1 nuevo
      expect(callBody.items[0].producto_id).toBe("prod-1");
      expect(callBody.items[0].cantidad_solicitada).toBe(10);
    });

    it("llama onOrderEdited y onClose al guardar exitosamente", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

      renderDialog(true);

      fireEvent.click(screen.getByText("Guardar cambios"));

      await waitFor(() => {
        expect(mockOnOrderEdited).toHaveBeenCalledTimes(1);
        expect(mockOnClose).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("EOI-06: manejo de errores", () => {
    it("muestra error si el PATCH falla", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Solo se pueden editar órdenes pendientes" }),
      });

      renderDialog(true);

      fireEvent.click(screen.getByText("Guardar cambios"));

      await waitFor(() => {
        expect(screen.getByText("Solo se pueden editar órdenes pendientes")).toBeInTheDocument();
      });

      expect(mockOnOrderEdited).not.toHaveBeenCalled();
    });
  });
});
