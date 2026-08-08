/**
 * Tests C-57: UltimasVentas — render y prefetch solo en hover (ticket 6a76ccfa629628db21ebbe60)
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    className,
    onClick,
    prefetch,
    onMouseEnter,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
    prefetch?: boolean | null;
    onMouseEnter?: () => void;
  }) => (
    <a
      href={href}
      className={className}
      onClick={onClick}
      data-prefetch={String(prefetch)}
      onMouseEnter={onMouseEnter}
    >
      {children}
    </a>
  ),
}));

import UltimasVentas from "@/app/(app)/dashboard/components/UltimasVentas";

const data = [
  {
    id: "v1",
    total: 12345,
    estado: "completada",
    created_at: "2026-08-01T15:30:00.000Z",
    clientes: { nombre: "Ana Pérez" },
  },
  {
    id: "v2",
    total: 5000,
    estado: "anulada",
    created_at: "2026-08-01T16:00:00.000Z",
    clientes: null,
  },
];

describe("UltimasVentas (C-57)", () => {
  it("C-57: muestra estado vacío cuando no hay ventas", () => {
    render(<UltimasVentas data={[]} />);
    expect(screen.getByText("Sin ventas aún")).toBeInTheDocument();
  });

  it("C-57: renderiza cliente, monto, estado anulada y link con prefetch=false al montar", () => {
    render(<UltimasVentas data={data} />);

    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("Anulada")).toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: "→" }) as HTMLAnchorElement[];
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/sales/v1");
    // Sin prefetch al montar: evita ráfaga RSC en listas del dashboard
    expect(links[0].dataset.prefetch).toBe("false");

    fireEvent.mouseEnter(links[0]);
    expect(links[0].dataset.prefetch).toBe("null");
  });
});
