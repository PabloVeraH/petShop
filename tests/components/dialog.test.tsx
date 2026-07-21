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
  const MockPopup = React.forwardRef<HTMLDivElement, WithChildren & WithClassName & Record<string, unknown>>(
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
