/** @jest-environment jsdom */
/**
 * Test PC-13: POS Carrito — regresión "Cobrar $0" con el mecanismo REAL
 * de rehidratación de Zustand persist (no una simulación con setState).
 *
 * A diferencia de pos-carrito-subtotal.test.tsx (que llama usePOSStore.setState()
 * ANTES de renderizar, lo cual no reproduce la ventana de tiempo real), este test:
 *   1. Pre-popula localStorage con un carrito persistido, ANTES de importar el
 *      módulo del store (import dinámico, sin haberlo importado antes en este
 *      archivo — cada archivo de test tiene su propio registro de módulos en
 *      Jest) — así el middleware persist real ejecuta su hydrate() asíncrono
 *      real al crear el store, en vez de simular el estado con setState().
 *   2. Renderiza Carrito INMEDIATAMENTE, antes de que el microtask de
 *      hydrate() se resuelva (igual que el mount inicial en el navegador,
 *      que ocurre antes de que se resuelva la promesa de storage.getItem()).
 *   3. Espera (waitFor) a que el footer refleje el total real — confirmando
 *      que el re-render posterior a la rehidratación async es correcto.
 *
 * NOTA DE VERIFICACIÓN DE INFRAESTRUCTURA: este test usa el código real de
 * node_modules/zustand (persist middleware) y localStorage real de jsdom, pero
 * jsdom/Jest ejecutan todo en un único hilo sin el scheduling concurrente/interrumpible
 * de React en un navegador real. Por lo tanto, sigue sin ser una prueba 100%
 * equivalente a producción. Verificación pendiente en navegador real: ver informe.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

describe("POS Carrito — regresión: rehidratación REAL de persist (PC-13)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  // PC-13: REGRESIÓN — con un carrito persistido en localStorage ANTES de montar,
  // el footer debe mostrar el total real tras la rehidratación real (asíncrona),
  // sin que el usuario tenga que eliminar y re-agregar productos.
  it("PC-13: con carrito persistido en localStorage, el footer converge al total real tras la rehidratación asíncrona", async () => {
    const persisted = {
      state: {
        items: [
          { id: "a", producto_id: "p1", nombre: "Whiskas 1kg", precio: 15458, cantidad: 1, subtotal: 15458 },
        ],
        descuento: 0,
      },
      version: 0,
    };
    window.localStorage.setItem("pos-cart", JSON.stringify(persisted));

    // Import dinámico DESPUÉS de poblar localStorage y resetear módulos —
    // fuerza a que create(persist(...)) se re-ejecute y dispare hydrate() real
    // leyendo el localStorage recién poblado.
    const { default: Carrito } = await import("@/app/(app)/pos/components/Carrito");

    render(React.createElement(Carrito));

    // Debe converger al total real ($15.458) — nunca quedarse en "$0" ni en el
    // placeholder de carrito vacío una vez que la rehidratación se resuelve.
    await waitFor(() => {
      expect(screen.getByText("$15.458")).toBeInTheDocument();
    });
    expect(screen.queryByText("Agrega productos desde la búsqueda")).not.toBeInTheDocument();
  });
});
