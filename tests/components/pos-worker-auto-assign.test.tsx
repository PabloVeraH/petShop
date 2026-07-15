/** @jest-environment jsdom */
/**
 * Tests PP-07 a PP-11: POS worker auto-assignment behavior
 * Verifica que el useEffect en POSPage asigna automáticamente
 * al usuario logueado como vendedor por defecto.
 *
 * Renombrados desde PC-01..05: colisionaban con el prefijo PC-NN, ya
 * reservado para tests de componente de Carrito (ver docs/spec-registry.md)
 * — estos tests son de POSPage, no de Carrito, así que corresponden al
 * prefijo PP-NN (continúa PP-01..06 de POSPage.test.tsx).
 */
import "@testing-library/jest-dom";
import React, { useEffect, useRef } from "react";
import { render } from "@testing-library/react";
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

beforeEach(() => {
  Object.keys(storage).forEach((k) => delete storage[k]);
  usePOSStore.getState().clearCart();
  usePOSStore.getState().setWorker(undefined); // clearCart preserva worker, reseteamos explícitamente
  jest.clearAllMocks();
});

// Componente que replica el useEffect de auto-asignación de POSPage
function AutoAssignWorker({ userId }: { userId: string | null }) {
  const initializedWorkerForRef = useRef<string | null>(null);
  const setWorker = usePOSStore((s) => s.setWorker);

  useEffect(() => {
    if (!userId) return;
    if (initializedWorkerForRef.current === userId) return;
    initializedWorkerForRef.current = userId;
    setWorker(userId);
  }, [userId, setWorker]);

  return null;
}

// PP-07
it("PP-07: useEffect asigna workerClerkId al userId cuando el componente monta", () => {
  render(<AutoAssignWorker userId="user-clerk-123" />);
  expect(usePOSStore.getState().workerClerkId).toBe("user-clerk-123");
});

// PP-08
it("PP-08: useEffect no asigna worker cuando userId es null (Clerk loading)", () => {
  render(<AutoAssignWorker userId={null} />);
  expect(usePOSStore.getState().workerClerkId).toBeUndefined();
});

// PP-09
it("PP-09: useEffect asigna worker cuando userId cambia de null a un valor (Clerk carga después)", () => {
  const { rerender } = render(<AutoAssignWorker userId={null} />);
  expect(usePOSStore.getState().workerClerkId).toBeUndefined();

  rerender(<AutoAssignWorker userId="user-loaded-456" />);
  expect(usePOSStore.getState().workerClerkId).toBe("user-loaded-456");
});

// PP-10
it("PP-10: useEffect no sobreescribe workerClerkId si ya se inicializó para el mismo userId", () => {
  usePOSStore.getState().setWorker("user-existing-789");
  const { rerender } = render(<AutoAssignWorker userId="user-existing-789" />);
  // El ref se inicializa pero como "user-existing-789" ya está seteado, no cambia
  expect(usePOSStore.getState().workerClerkId).toBe("user-existing-789");

  // Simular que el usuario cambia manualmente a otro vendedor
  usePOSStore.getState().setWorker("other-worker-999");
  expect(usePOSStore.getState().workerClerkId).toBe("other-worker-999");

  // Si el mismo userId vuelve a renderizar, no debe pisar la selección manual
  rerender(<AutoAssignWorker userId="user-existing-789" />);
  // Como initializedWorkerForRef.current === userId, no sobreescribe
  expect(usePOSStore.getState().workerClerkId).toBe("other-worker-999");
});

// PP-11: simula el escenario de cambio de turno (otro usuario se loguea)
it("PP-11: useEffect resetea worker cuando un usuario diferente se loguea (cambio de turno)", () => {
  const { rerender } = render(<AutoAssignWorker userId="pedro" />);
  expect(usePOSStore.getState().workerClerkId).toBe("pedro");

  // Pedro cambia manualmente a "juan" para vender en su nombre
  usePOSStore.getState().setWorker("juan");
  expect(usePOSStore.getState().workerClerkId).toBe("juan");

  // Llega "maria" y se loguea — como el userId cambió, el ref no coincide
  rerender(<AutoAssignWorker userId="maria" />);
  expect(usePOSStore.getState().workerClerkId).toBe("maria");
});
