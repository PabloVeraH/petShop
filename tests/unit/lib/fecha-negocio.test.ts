/**
 * U-215: fechaNegocioISO — "hoy" en America/Santiago, sin depender del TZ del
 * proceso (Vercel corre en UTC). Lo usa GET /api/ventas/[id] para decidir si
 * una venta es "del día" para el worker (SEC-14).
 */
import { fechaNegocioISO } from "@/lib/dates";

describe("fechaNegocioISO (U-215)", () => {
  it("U-215: 02:00 UTC del 28-09 es todavía el 27-09 en Chile (UTC-3)", () => {
    expect(fechaNegocioISO(new Date("2026-09-28T02:00:00Z"))).toBe("2026-09-27");
  });

  it("U-215: 15:00 UTC es el mismo día en Chile", () => {
    expect(fechaNegocioISO(new Date("2026-09-27T15:00:00Z"))).toBe("2026-09-27");
  });

  it("U-215: invierno (UTC-4): 03:30 UTC del 16-06 es el 15-06 en Chile", () => {
    expect(fechaNegocioISO(new Date("2026-06-16T03:30:00Z"))).toBe("2026-06-15");
  });
});
