/**
 * DA-13: "Top 5 productos hoy" muestra la cantidad con coma decimal y hasta
 * 2 decimales (granel en sacos: 1,02); enteros sin decimales.
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import TopProductos from "@/app/(app)/dashboard/components/TopProductos";

describe("TopProductos (DA-13)", () => {
  it("DA-13: enteros tal cual y granel con coma y hasta 2 decimales", () => {
    render(<TopProductos data={[
      { producto_id: "a", nombre: "Lata", cantidad: 3 },
      { producto_id: "b", nombre: "Saco", cantidad: 1.02 },
      { producto_id: "c", nombre: "Tercio", cantidad: 0.5 },
    ]} />);
    expect(screen.getByText("Lata").nextSibling).toHaveTextContent(/^3$/);
    expect(screen.getByText("Saco").nextSibling).toHaveTextContent(/^1,02$/);
    expect(screen.getByText("Tercio").nextSibling).toHaveTextContent(/^0,5$/);
  });

  it("DA-13: sin datos muestra 'Sin ventas hoy'", () => {
    render(<TopProductos data={[]} />);
    expect(screen.getByText("Sin ventas hoy")).toBeInTheDocument();
  });
});
