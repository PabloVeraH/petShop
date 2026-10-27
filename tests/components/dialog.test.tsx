/**
 * Tests DLG-01 a DLG-02: Dialog component scrollability
 * - DLG-01: DialogContent tiene clase overflow-y-auto
 * - DLG-02: DialogContent tiene clase max-h-[85vh]
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";

type WithChildren = { children: React.ReactNode };
type WithClassName = { className?: string };

jest.mock("@base-ui/react/dialog", () => {
  const MockPopup = React.forwardRef<HTMLDivElement, WithChildren & WithClassName & React.HTMLAttributes<HTMLDivElement>>(
    ({ children, className, ...props }, ref) => (
      <div ref={ref} className={className} data-testid="mock-popup" {...props}>
        {children}
      </div>
    ),
  );
  MockPopup.displayName = "MockPopup";

  return {
    Dialog: {
      Root: ({ children }: WithChildren) => <>{children}</>,
      Trigger: ({ children }: WithChildren) => <>{children}</>,
      Close: ({ children }: WithChildren) => <>{children}</>,
      Portal: ({ children }: WithChildren) => <>{children}</>,
      Backdrop: () => null,
      Popup: MockPopup,
      Title: ({ children }: WithChildren) => <>{children}</>,
      Description: ({ children }: WithChildren) => <>{children}</>,
    },
  };
});

import { Dialog, DialogContent } from "@/components/ui/dialog";

describe("DialogContent — scroll en viewports pequeños (DLG-01/DLG-02)", () => {
  it('DLG-01: renderiza con clase overflow-y-auto', () => {
    render(
      <Dialog open>
        <DialogContent>contenido</DialogContent>
      </Dialog>,
    );
    const popup = screen.getByTestId("mock-popup");
    expect(popup.className).toContain("overflow-y-auto");
  });

  it('DLG-02: renderiza con clase max-h-[85vh]', () => {
    render(
      <Dialog open>
        <DialogContent>contenido</DialogContent>
      </Dialog>,
    );
    const popup = screen.getByTestId("mock-popup");
    expect(popup.className).toContain("max-h-[85vh]");
  });
});

// DLG-03 — REGRESIÓN: la base trae sm:max-w-sm (24rem). Un ancho pedido sin
// prefijo (max-w-2xl) no lo reemplaza y en pantallas sm+ el popup quedaba en
// 24rem (detalle de /vendedores). Pedido como sm:max-w-*, cn (tailwind-merge)
// descarta el sm:max-w-sm de la base.
describe("DialogContent — ancho pedido por la pantalla (DLG-03)", () => {
  it("DLG-03: className sm:max-w-3xl reemplaza el sm:max-w-sm de la base", () => {
    render(
      <Dialog open>
        <DialogContent className="sm:max-w-3xl">contenido</DialogContent>
      </Dialog>,
    );
    const clases = screen.getByTestId("mock-popup").className.split(/\s+/);
    expect(clases).toContain("sm:max-w-3xl");
    expect(clases).not.toContain("sm:max-w-sm");
  });

  it("DLG-03: sin className se mantiene el ancho por defecto sm:max-w-sm", () => {
    render(
      <Dialog open>
        <DialogContent>contenido</DialogContent>
      </Dialog>,
    );
    expect(screen.getByTestId("mock-popup").className.split(/\s+/)).toContain("sm:max-w-sm");
  });
});
