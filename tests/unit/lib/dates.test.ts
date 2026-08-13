/**
 * Unit tests U-150 / U-151: src/lib/dates.ts — parseo/format de fechas
 * "date-only" (columnas DATE de Postgres, "YYYY-MM-DD").
 *
 * Regresión ticket Trello 6a77ef3a0ed45ac54505c62a: new Date("2026-05-01")
 * interpreta la cadena como medianoche UTC y, formateada en América/Santiago
 * (UTC-3/-4), desplaza la fecha 1 día antes (30-04-2026). El sufijo
 * "T00:00:00" preserva el componente de fecha sin importar el huso del proceso.
 */
import { formatDateOnlyEsCL, parseDateOnlyLocal } from "@/lib/dates";

describe("parseDateOnlyLocal", () => {
  // U-150
  it("U-150: parsea 'YYYY-MM-DD' como medianoche LOCAL preservando el día (31-12-2026 no se desplaza a 30-12)", () => {
    const d = parseDateOnlyLocal("2026-12-31");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11); // diciembre (0-indexado)
    expect(d.getDate()).toBe(31);
    expect(d.getHours()).toBe(0);
  });
});

describe("formatDateOnlyEsCL", () => {
  // U-151: con los valores reales del repro ("2026-05-01"/"2026-12-31") el
  // texto es igual a la fecha almacenada, sin el 1 día de desfase.
  it("U-151: formatea la fecha almacenada sin desfase (2026-05-01 → 01-05-2026)", () => {
    expect(formatDateOnlyEsCL("2026-05-01")).toBe("01-05-2026");
    expect(formatDateOnlyEsCL("2026-12-31")).toBe("31-12-2026");
    expect(formatDateOnlyEsCL("2026-05-01")).not.toBe("30-04-2026");
    expect(formatDateOnlyEsCL("2026-12-31")).not.toBe("30-12-2026");
  });
});