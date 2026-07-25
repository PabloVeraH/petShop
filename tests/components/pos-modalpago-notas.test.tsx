/** @jest-environment jsdom */
/**
 * Test MP-20: ModalPago — "Notas internas" con el store real (no mockeado)
 *
 * Investigado a raíz del ticket Trello 6a62eb1e35946ffc7c2a818b ("Motivo
 * trunca a 1 carácter" en devoluciones/ajuste de stock). Ese bug era del
 * ModalOverlay custom (fix commit 1270b13, ver DV-17/IV-03/LP-01) — ModalPago
 * usa el Dialog real de @base-ui/react (no el ModalOverlay), y "Notas
 * internas" no es estado local sino un campo de usePOSStore (Zustand). Ningún
 * mecanismo equivalente al bug original aplica acá, pero el campo no tenía
 * NINGÚN test — ni siquiera con el store mockeado (ModalPago.test.tsx no
 * incluye notas/setNotas en su mock de usePOSStore).
 *
 * Este archivo usa el store real (igual que pos-worker-auto-assign.test.tsx)
 * en vez de mockearlo, para ejercitar el mecanismo real de extremo a extremo:
 * escribir letra por letra dispara setNotas → set() de Zustand → re-render
 * del Dialog real, y verifica que ningún re-render pierde caracteres ni
 * vuelve a robar el foco.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePOSStore } from "@/stores/pos";

// Mock para Zustand persist (localStorage no disponible en jsdom)
const storage: Record<string, string> = {};
Object.defineProperty(global, "localStorage", {
  value: {
    getItem: jest.fn((k: string) => storage[k] ?? null),
    setItem: jest.fn((k: string, v: string) => { storage[k] = v; }),
    removeItem: jest.fn((k: string) => { delete storage[k]; }),
    clear: jest.fn(() => { Object.keys(storage).forEach((k) => delete storage[k]); }),
    length: 0,
    key: jest.fn(() => null),
  },
  writable: true,
});

global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] });

beforeEach(() => {
  Object.keys(storage).forEach((k) => delete storage[k]);
  usePOSStore.getState().clearCart();
  jest.clearAllMocks();
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => [] });
});

import ModalPago from "@/app/(app)/pos/components/ModalPago";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ModalPago onConfirm={jest.fn()} onCancel={jest.fn()} isLoading={false} />
    </QueryClientProvider>
  );
}

describe("ModalPago — Notas internas (store real)", () => {
  it("MP-20: escribir en Notas internas letra por letra no pierde caracteres ni roba el foco", () => {
    const focusSpy = jest.spyOn(HTMLElement.prototype, "focus");
    setup();
    const llamadasAlAbrir = focusSpy.mock.calls.length;

    const notasTextarea = screen.getByPlaceholderText("Observaciones (no visible en el recibo)");
    const texto = "QA test conteo fisico";
    let acumulado = "";
    for (const char of texto) {
      acumulado += char;
      fireEvent.change(notasTextarea, { target: { value: acumulado } });
    }

    expect(notasTextarea).toHaveValue(texto);
    expect(usePOSStore.getState().notas).toBe(texto);
    expect(focusSpy).toHaveBeenCalledTimes(llamadasAlAbrir);

    focusSpy.mockRestore();
  });
});
