/**
 * Tests AD-01 a AD-04: AccesoDenegadoPage — página dedicada de acceso denegado (403)
 * REGRESIÓN: antes del fix, el acceso a rutas restringidas mostraba un toast en el POS
 * que desaparecía a los 4.5s. Ahora hay una página dedicada con mensaje claro y botón de vuelta.
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

let mockSearchParamsGet: (key: string) => string | null = () => null;

jest.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => mockSearchParamsGet(k) }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

// ── Import después de mocks ───────────────────────────────────────────────────

import AccesoDenegadoPage from "@/app/(app)/acceso-denegado/page";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AccesoDenegadoPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParamsGet = () => null;
  });

  // AD-01: con from=/inventory muestra el label "Inventario" (lookup en SECTION_LABELS)
  it("AD-01: muestra nombre de sección conocida a partir del param from", () => {
    mockSearchParamsGet = (k) => k === "from" ? "/inventory" : null;

    render(<AccesoDenegadoPage />);

    expect(screen.getByText(/Inventario/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Acceso denegado/i })).toBeInTheDocument();
  });

  // AD-02: siempre muestra el botón/link "Volver al POS" apuntando a /pos
  it("AD-02: tiene link 'Volver al POS' que apunta a /pos", () => {
    mockSearchParamsGet = (k) => k === "from" ? "/inventory" : null;

    render(<AccesoDenegadoPage />);

    const link = screen.getByRole("link", { name: /Volver al POS/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/pos");
  });

  // AD-03: sin param from muestra mensaje genérico (no falla ni muestra ruta vacía)
  it("AD-03: sin param from muestra mensaje genérico de acceso denegado", () => {
    mockSearchParamsGet = () => null;

    render(<AccesoDenegadoPage />);

    expect(screen.getByRole("heading", { name: /Acceso denegado/i })).toBeInTheDocument();
    expect(screen.getByText(/no tiene permiso/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Volver al POS/i })).toBeInTheDocument();
  });

  // AD-04: con from=/ruta-desconocida muestra la ruta literal como fallback (no falla)
  it("AD-04: from con ruta no mapeada muestra la ruta literal como fallback", () => {
    mockSearchParamsGet = (k) => k === "from" ? "/ruta-desconocida" : null;

    render(<AccesoDenegadoPage />);

    expect(screen.getByText(/ruta-desconocida/)).toBeInTheDocument();
  });
});
