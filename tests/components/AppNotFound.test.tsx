/**
 * Tests NF-01 a NF-02: AppNotFound — página 404 con navegación
 * REGRESIÓN: cualquier ruta sin page (como /workers) mostraba pantalla negra
 * sin diseño del sistema, sin navegación lateral y sin botón de "Volver".
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

import AppNotFound from "@/app/(app)/not-found";

describe("AppNotFound (NF)", () => {

  // NF-01: muestra "404" y "Página no encontrada"
  it("NF-01: muestra título 404 y mensaje de página no encontrada", () => {
    render(<AppNotFound />);

    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByText("Página no encontrada")).toBeInTheDocument();
  });

  // NF-02: tiene link "Volver al inicio" apuntando a /dashboard
  it("NF-02: tiene link 'Volver al inicio' que apunta a /dashboard", () => {
    render(<AppNotFound />);

    const link = screen.getByRole("link", { name: /Volver al inicio/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/dashboard");
  });
});
