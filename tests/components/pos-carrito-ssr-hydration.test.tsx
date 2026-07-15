/** @jest-environment jsdom */
/**
 * Tests PC-14/PC-15: POS Carrito — SSR real seguido de hydrateRoot real.
 *
 * A diferencia de pos-carrito-real-rehydration.test.tsx (PC-13), que solo monta
 * el componente con `render()` (createRoot) tras poblar localStorage, este archivo
 * reproduce el mecanismo real de un Next.js App Router: el servidor renderiza sin
 * localStorage disponible (produce el carrito vacío) y el cliente hidrata ESA
 * misma cadena de fibers con React real (`hydrateRoot`).
 *
 * Hallazgo verificado (no asumido) al construir este test:
 *   - El middleware `persist` de Zustand 5.0.12 NO usa una Promise real para
 *     `localStorage.getItem` — su helper `toThenable` ejecuta la cadena `.then()`
 *     de forma síncrona cuando `storage.getItem` no devuelve una Promise (ver
 *     node_modules/zustand/esm/middleware.mjs). Por lo tanto `hydrate()` termina
 *     de forma síncrona, dentro de la misma llamada a `create()` — no hay
 *     microtask de por medio. Confirmado empíricamente: justo después de crear
 *     el store con localStorage ya poblado, `usePOSStore.persist.hasHydrated()`
 *     ya es `true` sin ningún `await`.
 *   - La divergencia real entre servidor y cliente no viene de eso, sino de
 *     `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` (usado
 *     internamente por Zustand — ver node_modules/zustand/esm/react.mjs): persist
 *     fija `api.getInitialState` al estado PRE-hidratación (`configResult`), y ese
 *     es el valor que React usa como `getServerSnapshot` tanto en el render del
 *     servidor como en el primer pase de `hydrateRoot`. React reconcilia
 *     automáticamente contra `getSnapshot()` (ya hidratado) inmediatamente
 *     después de confirmar la hidratación.
 *   - Bajo esta reproducción real, tanto el patrón ya corregido (Carrito.tsx,
 *     que deriva el total de `items`/`descuento` del mismo render) como el
 *     patrón viejo (getter `state.total()`) convergen correctamente al total real
 *     dentro del mismo `act()` — ninguno queda "pegado" en $0. Esto no prueba que
 *     este haya sido el disparador exacto del bug original reportado (la causa
 *     exacta de ese caso sigue sin confirmarse contra un navegador real — ver
 *     nota en PC-13); lo que sí prueba, de forma determinística y sin necesidad
 *     de `waitFor`, es que el código actual no depende de ninguna ventana de
 *     carrera para mostrar el total correcto tras una hidratación real de
 *     Next.js — cumple la invariante de stores/pos.ts (items/descuento del mismo
 *     render) incluso en el peor caso: primer pase de hidratación con
 *     `getServerSnapshot` desactualizado.
 *
 * Cada pase (servidor / cliente) importa React, react-dom y el componente vía
 * `import()` dinámico tras `jest.resetModules()`, para obtener un registro de
 * módulos fresco por pase — igual a como el bundle de servidor y el bundle de
 * cliente de Next.js son, en la práctica, dos evaluaciones de módulo separadas.
 */

async function renderServerThenHydrate(
  seedCart: { items: unknown[]; descuento: number } | null
) {
  const realLS = window.localStorage;
  // @ts-expect-error -- simula la ausencia real de localStorage en el servidor
  delete window.localStorage;

  jest.resetModules();
  const ReactServer = (await import("react")).default;
  const { renderToString } = await import("react-dom/server");
  const ServerCarrito = (await import("@/app/(app)/pos/components/Carrito")).default;
  const serverHtml = renderToString(ReactServer.createElement(ServerCarrito));

  Object.defineProperty(window, "localStorage", { value: realLS, configurable: true });
  window.localStorage.clear();
  if (seedCart) {
    window.localStorage.setItem(
      "pos-cart",
      JSON.stringify({ state: seedCart, version: 0 })
    );
  }

  const container = document.createElement("div");
  container.innerHTML = serverHtml;
  document.body.appendChild(container);

  jest.resetModules();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const ReactClient = (await import("react")).default;
  const { hydrateRoot } = await import("react-dom/client");
  const ClientCarrito = (await import("@/app/(app)/pos/components/Carrito")).default;
  ReactClient.act(() => {
    hydrateRoot(container, ReactClient.createElement(ClientCarrito));
  });

  return { serverHtml, clientHtml: container.innerHTML };
}

describe("POS Carrito — SSR real + hydrateRoot real (PC-14/PC-15)", () => {
  // PC-14: REGRESIÓN — con carrito persistido, la hidratación real de React
  // (getServerSnapshot desactualizado -> getSnapshot ya hidratado) converge al
  // total correcto sin necesidad de que el usuario elimine y re-agregue productos.
  it("PC-14: SSR sin localStorage (carrito vacío) + hydrateRoot con carrito persistido converge al total real ($15.458)", async () => {
    const { serverHtml, clientHtml } = await renderServerThenHydrate({
      items: [{ id: "a", producto_id: "p1", nombre: "Whiskas 1kg", precio: 15458, cantidad: 1, subtotal: 15458 }],
      descuento: 0,
    });

    expect(serverHtml).toContain("Agrega productos desde la búsqueda");
    expect(clientHtml).not.toContain("Agrega productos desde la búsqueda");
    expect(clientHtml).toContain("15.458");
  });

  // PC-15: sin carrito persistido, la hidratación no inventa contenido — el
  // estado vacío es coherente entre servidor y cliente.
  it("PC-15: SSR sin localStorage + hydrateRoot sin carrito persistido se mantiene vacío tras hidratar", async () => {
    const { serverHtml, clientHtml } = await renderServerThenHydrate(null);

    expect(serverHtml).toContain("Agrega productos desde la búsqueda");
    expect(clientHtml).toContain("Agrega productos desde la búsqueda");
  });
});
