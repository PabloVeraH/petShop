/** @jest-environment jsdom */
/**
 * Tests BTN-01 a BTN-04: Botón con disabled prop
 * Verifica que @base-ui/react Button usa data-disabled (no disabled HTML attr)
 * y que la integración con Tailwind CSS aplica los estilos correspondientes.
 *
 * Bug: el CSS usaba disabled:opacity-50 que requiere :disabled pseudo-clase,
 * pero Base UI renderiza con data-disabled en su lugar. El botón se veía activo
 * aunque funcionalmente estuviera deshabilitado.
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "@/components/ui/button";

describe("Button disabled state (regression BTN-01..04)", () => {
  it("BTN-01: disabled=true agrega atributo data-disabled al DOM", () => {
    render(<Button disabled>Test</Button>);
    const btn = screen.getByRole("button", { name: "Test" });
    expect(btn).toHaveAttribute("data-disabled");
  });

  it("BTN-02: disabled=true bloquea onClick", () => {
    const handleClick = jest.fn();
    render(<Button disabled onClick={handleClick}>Test</Button>);
    const btn = screen.getByRole("button", { name: "Test" });
    fireEvent.click(btn);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("BTN-03: disabled=false NO agrega data-disabled", () => {
    render(<Button>Test</Button>);
    const btn = screen.getByRole("button", { name: "Test" });
    expect(btn).not.toHaveAttribute("data-disabled");
  });

  it("BTN-04: disabled=false permite onClick", () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Test</Button>);
    const btn = screen.getByRole("button", { name: "Test" });
    fireEvent.click(btn);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
