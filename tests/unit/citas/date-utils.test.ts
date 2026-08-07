/**
 * Tests U-CITA-34 a U-CITA-37: formatFechaHora — formateo local de timestamps
 * ISO para el detalle/lista de citas (ticket 6a7160fe621dcf1dba95b92f).
 *
 * Los fixtures se construyen EN hora local (`new Date(y, m-1, d, hh, mm)`) y
 * se serializan a ISO, de modo que las expectativas no dependan del huso
 * horario de la máquina de CI — setear process.env.TZ en el test no es fiable
 * porque V8 cachea el offset tras la primera operación Date.
 */
import { formatFechaHora, hoyLocal } from "@/app/(app)/citas/components/date-utils";

// ISO de una fecha/hora dada en ZONA LOCAL de la máquina de test.
function isoLocal(y: number, m: number, d: number, hh: number, mm: number): string {
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

describe("formatFechaHora", () => {
  // U-CITA-34
  it("U-CITA-34: timestamp ISO → DD/MM/YYYY HH:MM en zona local", () => {
    expect(formatFechaHora(isoLocal(2026, 8, 4, 3, 47))).toBe("04/08/2026 03:47");
    expect(formatFechaHora(isoLocal(2026, 8, 15, 23, 5))).toBe("15/08/2026 23:05");
  });

  // U-CITA-35
  it("U-CITA-35: null/undefined/vacío → cadena vacía", () => {
    expect(formatFechaHora(null)).toBe("");
    expect(formatFechaHora(undefined)).toBe("");
    expect(formatFechaHora("")).toBe("");
  });

  // U-CITA-36
  it("U-CITA-36: ISO inválido → cadena vacía (no devuelve 'Invalid Date')", () => {
    expect(formatFechaHora("no-es-fecha")).toBe("");
    expect(formatFechaHora("2026-13-99T99:99:00Z")).toBe("");
  });
});

describe("hoyLocal", () => {
  // U-CITA-37: reloj fijado en hora LOCAL (no UTC) para que el resultado no
  // dependa del huso de la máquina.
  it("U-CITA-37: devuelve la fecha local en YYYY-MM-DD", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 15, 12, 0));
    expect(hoyLocal()).toBe("2026-08-15");
    jest.useRealTimers();
  });
});
