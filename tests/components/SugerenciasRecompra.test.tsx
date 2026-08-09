/**
 * Tests C-58: SugerenciasRecompra — render y prefetch solo en hover
 * (revisión del ticket 6a76ccfa629628db21ebbe60: mismo patrón de
 * HoverPrefetchLink ya aplicado a UltimasVentas/sidebar/tabla de Ventas,
 * pero encontrado sin corregir en este widget del dashboard — un
 * <Link href="/purchases"> dentro de data.map(), uno por sugerencia).
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

import SugerenciasRecompra from "@/app/(app)/dashboard/components/SugerenciasRecompra";

const data = [
  {
    producto_nombre: "Alimento Gato Whiskas 1kg",
    sku: "SKU-1",
    stock_actual: 2,
    dias_restantes: 3,
    mascota_nombre: "Firulais",
    cliente_nombre: "Ana Pérez",
    urgente: true,
    proveedores: [{ nombre: "Distribuidora Sur", costo: 8000, tiempo_entrega_dias: 2 }],
  },
];

describe("SugerenciasRecompra (C-58)", () => {
  it("C-58: muestra estado vacío cuando no hay sugerencias", () => {
    render(<SugerenciasRecompra data={[]} />);
    expect(screen.getByText("Sin sugerencias activas")).toBeInTheDocument();
  });

  it("C-58: renderiza la sugerencia y el link '+ OC' con prefetch=false al montar, null tras hover", () => {
    render(<SugerenciasRecompra data={data} />);

    expect(screen.getByText("Alimento Gato Whiskas 1kg")).toBeInTheDocument();
    expect(screen.queryByText("¡Agotado!")).not.toBeInTheDocument();
    expect(screen.getByText("3 días restantes")).toBeInTheDocument();

    const link = screen.getByText("+ OC").closest("a") as HTMLAnchorElement;
    expect(link).toHaveAttribute("href", "/purchases");
    // Sin prefetch al montar: evita ráfaga RSC cuando hay varias sugerencias en pantalla
    expect(link.dataset.prefetch).toBe("false");

    fireEvent.mouseEnter(link);
    expect(link.dataset.prefetch).toBe("null");
  });
});
