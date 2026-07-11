import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModalOverlay } from "@/components/ui/modal-overlay";

describe("ModalOverlay", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // jsdom doesn't support document.hasFocus() returning true,
    // but we can stub focus() to track calls
    HTMLElement.prototype.focus = jest.fn();
  });

  it("renderiza children cuando open=true", () => {
    render(<ModalOverlay open onClose={jest.fn()}><div>contenido</div></ModalOverlay>);
    expect(screen.getByText("contenido")).toBeInTheDocument();
  });

  it("no renderiza cuando open=false", () => {
    render(<ModalOverlay open={false} onClose={jest.fn()}><div>contenido</div></ModalOverlay>);
    expect(screen.queryByText("contenido")).not.toBeInTheDocument();
  });

  it("llama onClose al hacer click fuera (overlay click)", () => {
    const onClose = jest.fn();
    render(<ModalOverlay open onClose={onClose}><div>contenido</div></ModalOverlay>);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("NO llama onClose al hacer click dentro (children click)", () => {
    const onClose = jest.fn();
    render(<ModalOverlay open onClose={onClose}><div>contenido</div></ModalOverlay>);
    fireEvent.click(screen.getByText("contenido"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("llama onClose al presionar Escape", () => {
    const onClose = jest.fn();
    render(<ModalOverlay open onClose={onClose}><div>contenido</div></ModalOverlay>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("actualiza onCloseRef cuando onClose cambia (para evitar focus steal en re-renders)", () => {
    // Este test verifica que la ref interna se actualiza aunque el useEffect
    // solo dependa de [open], previniendo que el efecto se re-ejecute en re-renders.
    const onClose1 = jest.fn();
    const { rerender } = render(<ModalOverlay open onClose={onClose1}><div>contenido</div></ModalOverlay>);

    const onClose2 = jest.fn();
    rerender(<ModalOverlay open onClose={onClose2}><div>contenido</div></ModalOverlay>);

    // Escape debe llamar a onClose2 (el más reciente), no a onClose1
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose2).toHaveBeenCalledTimes(1);
    expect(onClose1).not.toHaveBeenCalled();
  });

  it("solo enfoca el overlay cuando se abre, no en re-renders con onClose distinto", () => {
    const focusSpy = jest.spyOn(HTMLElement.prototype, "focus");

    const onClose1 = jest.fn();
    const { rerender } = render(<ModalOverlay open onClose={onClose1}><div>contenido</div></ModalOverlay>);

    // Al render inicial, focus() se llama una vez
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // Al re-renderizar con onClose distinto, NO debe llamar focus() otra vez
    const onClose2 = jest.fn();
    rerender(<ModalOverlay open onClose={onClose2}><div>contenido</div></ModalOverlay>);
    expect(focusSpy).toHaveBeenCalledTimes(1); // Sigue siendo 1 — no se llamó de nuevo

    focusSpy.mockRestore();
  });
});
