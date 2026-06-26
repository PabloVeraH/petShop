/**
 * Tests NF-03 a NF-04: RootNotFound — página 404 raíz para rutas fuera de (app)
 * REGRESIÓN: rutas como /sessions mostraban pantalla negra sin diseño del sistema.
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import RootNotFound from "@/app/not-found";

describe("RootNotFound (NF)", () => {

  // NF-03
  it("NF-03: muestra título 404 y mensaje de página no encontrada", () => {
    render(<RootNotFound />);

    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByText("Página no encontrada")).toBeInTheDocument();
  });

  // NF-04
  it("NF-04: tiene link 'Volver al inicio' que apunta a /dashboard", () => {
    render(<RootNotFound />);

    const link = screen.getByRole("link", { name: /Volver al inicio/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/dashboard");
  });
});
