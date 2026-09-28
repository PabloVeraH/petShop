/**
 * U-218 (QA 2026-09-27): tras un 429, la consulta se vuelve a pedir al vencer
 * el Retry-After (TanStack Query no la reintenta: reintentarQuery).
 * @jest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";
import { useReintentoTrasLimite } from "@/hooks/useReintentoTrasLimite";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("useReintentoTrasLimite (U-218)", () => {
  it("U-218: con 429 y Retry-After 42 reintenta a los 42 s, no antes", () => {
    const reintentar = jest.fn();
    renderHook(() => useReintentoTrasLimite(new ApiError("x", 429, 42), reintentar));
    jest.advanceTimersByTime(41_000);
    expect(reintentar).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(reintentar).toHaveBeenCalledTimes(1);
  });

  it("U-218: 429 sin Retry-After usa la espera por defecto", () => {
    const reintentar = jest.fn();
    renderHook(() => useReintentoTrasLimite(new ApiError("x", 429, null), reintentar, 30));
    jest.advanceTimersByTime(30_000);
    expect(reintentar).toHaveBeenCalledTimes(1);
  });

  it("U-218: otros errores (500) o sin error no programan reintento", () => {
    const reintentar = jest.fn();
    renderHook(() => useReintentoTrasLimite(new ApiError("x", 500), reintentar));
    renderHook(() => useReintentoTrasLimite(null, reintentar));
    jest.advanceTimersByTime(120_000);
    expect(reintentar).not.toHaveBeenCalled();
  });

  it("U-218: al desmontar se cancela el reintento pendiente", () => {
    const reintentar = jest.fn();
    const { unmount } = renderHook(() => useReintentoTrasLimite(new ApiError("x", 429, 5), reintentar));
    unmount();
    jest.advanceTimersByTime(10_000);
    expect(reintentar).not.toHaveBeenCalled();
  });
});
