/** @jest-environment jsdom */
/**
 * Tests PC-01 a PC-04: POS worker auto-assignment behavior
 * Verifica que el useEffect en POSPage asigna automáticamente
 * al usuario logueado como vendedor por defecto.
 */
import "@testing-library/jest-dom";
import React, { useEffect, useRef } from "react";
import { render, renderHook, act } from "@testing-library/react";
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

// PC-01
it("PC-01: useEffect asigna workerClerkId al userId cuando el componente monta", () => {
  render(<AutoAssignWorker userId="user-clerk-123" />);
  expect(usePOSStore.getState().workerClerkId).toBe("user-clerk-123");
});

// PC-02
it("PC-02: useEffect no asigna worker cuando userId es null (Clerk loading)", () => {
  render(<AutoAssignWorker userId={null} />);
  expect(usePOSStore.getState().workerClerkId).toBeUndefined();
});

// PC-03
it("PC-03: useEffect asigna worker cuando userId cambia de null a un valor (Clerk carga después)", () => {
  const { rerender } = render(<AutoAssignWorker userId={null} />);
  expect(usePOSStore.getState().workerClerkId).toBeUndefined();

  rerender(<AutoAssignWorker userId="user-loaded-456" />);
  expect(usePOSStore.getState().workerClerkId).toBe("user-loaded-456");
});

// PC-04
it("PC-04: useEffect no sobreescribe workerClerkId si ya se inicializó para el mismo userId", () => {
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

// PC-05: simula el escenario de cambio de turno (otro usuario se loguea)
it("PC-05: useEffect resetea worker cuando un usuario diferente se loguea (cambio de turno)", () => {
  const { rerender } = render(<AutoAssignWorker userId="pedro" />);
  expect(usePOSStore.getState().workerClerkId).toBe("pedro");

  // Pedro cambia manualmente a "juan" para vender en su nombre
  usePOSStore.getState().setWorker("juan");
  expect(usePOSStore.getState().workerClerkId).toBe("juan");

  // Llega "maria" y se loguea — como el userId cambió, el ref no coincide
  rerender(<AutoAssignWorker userId="maria" />);
  expect(usePOSStore.getState().workerClerkId).toBe("maria");
});
