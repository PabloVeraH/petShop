/** @jest-environment jsdom */
/**
 * Test PC-13: POS Carrito — regresión "Cobrar $0" con el mecanismo REAL
 * de rehidratación de Zustand persist (no una simulación con setState).
 *
 * CORRECCIÓN respecto a la versión original de este comentario: el middleware
 * `persist` de Zustand 5.0.12 NO ejecuta `hydrate()` de forma asíncrona para
 * `localStorage` — su helper interno `toThenable` (node_modules/zustand/esm/
 * middleware.mjs) evita el uso de una Promise real cuando `storage.getItem` no
 * devuelve una (que es el caso de `localStorage`, síncrono), por lo que toda la
 * cadena `.then()` de `hydrate()` corre sincrónicamente dentro de la misma
 * llamada a `create()`. Verificado leyendo el código fuente instalado y de forma
 * empírica: justo después de crear el store con localStorage ya poblado,
 * `usePOSStore.persist.hasHydrated()` ya es `true` sin ningún `await`. Ver
 * pos-carrito-ssr-hydration.test.tsx (PC-14/PC-15) para la explicación completa
 * del mecanismo real que sí puede desincronizar servidor y cliente
 * (`useSyncExternalStore` + `getServerSnapshot` fijado al estado pre-hidratación).
 *
 * A diferencia de pos-carrito-subtotal.test.tsx (que llama usePOSStore.setState()
 * ANTES de renderizar, lo cual no reproduce la ventana de tiempo real), este test:
 *   1. Pre-popula localStorage con un carrito persistido, ANTES de importar el
 *      módulo del store (import dinámico, sin haberlo importado antes en este
 *      archivo — cada archivo de test tiene su propio registro de módulos en
 *      Jest) — así el middleware persist real ejecuta su `hydrate()` al crear
 *      el store, en vez de simular el estado con setState().
 *   2. Renderiza Carrito con `render()` (createRoot, no hydrateRoot) y usa
 *      `waitFor` por robustez, aunque — dado que `hydrate()` es síncrono para
 *      localStorage — el total ya debería estar correcto desde el primer render.
 *
 * NOTA DE VERIFICACIÓN DE INFRAESTRUCTURA: `render()` (createRoot) nunca invoca
 * `getServerSnapshot`, así que este test NO ejercita el mecanismo real de
 * hidratación de Next.js (servidor sin localStorage → `hydrateRoot` en cliente).
 * Ese mecanismo se reproduce de forma determinística con React real
 * (`renderToString` + `hydrateRoot` + `act`) en PC-14/PC-15. Ninguno de los dos
 * archivos logra reproducir el bug original reportado contra el código pre-fix
 * (tanto el patrón viejo del getter como el nuevo convergen correctamente bajo
 * ambos mecanismos) — la causa exacta del caso original reportado en producción
 * sigue sin confirmarse contra un navegador real con sesión autenticada; no hay
 * credenciales de prueba ni harness e2e en este repo. El valor de estos tests no
 * es demostrar el fallo pre-fix, sino fijar por construcción la invariante de
 * stores/pos.ts (derivar siempre de items/descuento del mismo render) bajo los
 * dos mecanismos de desincronización servidor/cliente más plausibles conocidos.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

describe("POS Carrito — regresión: rehidratación REAL de persist (PC-13)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  // PC-13: REGRESIÓN — con un carrito persistido en localStorage ANTES de montar,
  // el footer debe mostrar el total real tras la rehidratación real de Zustand,
  // sin que el usuario tenga que eliminar y re-agregar productos.
  it("PC-13: con carrito persistido en localStorage, el footer converge al total real tras la rehidratación real de persist", async () => {
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
