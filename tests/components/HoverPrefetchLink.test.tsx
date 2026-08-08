/**
 * Tests C-56: HoverPrefetchLink — prefetch solo en hover (ticket 6a76ccfa629628db21ebbe60)
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

import HoverPrefetchLink from "@/components/ui/HoverPrefetchLink";

describe("HoverPrefetchLink — prefetch solo en hover (C-56)", () => {
  it("C-56: renderiza un link con href, children y className, con prefetch=false al montar", () => {
    render(
      <HoverPrefetchLink href="/inventory" className="nav-link">
        Inventario
      </HoverPrefetchLink>
    );

    const link = screen.getByRole("link", { name: "Inventario" }) as HTMLAnchorElement;
    expect(link).toHaveAttribute("href", "/inventory");
    expect(link).toHaveClass("nav-link");
    // Sin prefetch al montar: evita la ráfaga RSC al cargar el sidebar
    expect(link.dataset.prefetch).toBe("false");
  });

  it("C-56: al hacer mouseEnter el prefetch pasa a null (= comportamiento por defecto) en el siguiente render", () => {
    render(
      <HoverPrefetchLink href="/inventory">
        Inventario
      </HoverPrefetchLink>
    );

    const link = screen.getByRole("link", { name: "Inventario" }) as HTMLAnchorElement;
    fireEvent.mouseEnter(link);
    expect(link.dataset.prefetch).toBe("null");
  });

  it("C-56: propaga onClick del link", () => {
    const onClick = jest.fn();
    render(
      <HoverPrefetchLink href="/inventory" onClick={onClick}>
        Inventario
      </HoverPrefetchLink>
    );

    fireEvent.click(screen.getByRole("link", { name: "Inventario" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
