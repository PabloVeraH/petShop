/**
 * Tests U-CITA-38/39: CitaCreateSchema — "hoy" se calcula con la fecha LOCAL
 * del servidor, no UTC (ticket 6a7161b4c5a35c889231c8a0).
 *
 * Contexto: la validación que rechaza fechas pasadas ya existía (refine con
 * hoyISO(), commit a9bcd33), pero hoyISO() usaba
 * `new Date().toISOString().split("T")[0]` (UTC). En husos negativos (Chile
 * UTC-4) entre las 20:00 y 23:59 locales, UTC ya cambió de día, así que
 * agendar para HOY era rechazado como "fecha pasada".
 *
 * Se fija TZ=America/Santiago: sin eso, en una CI corriendo en UTC la fecha
 * local y la UTC coinciden y el test no demostraría nada (pasaría con y sin
 * el fix). Con TZ fijado, la divergencia local/UTC existe en cualquier máquina.
 */
import { CitaCreateSchema } from "@/lib/validation/citas";

const ORIGINAL_TZ = process.env.TZ;

const BASE = {
  servicio_id: "123e4567-e89b-12d3-a456-426614174100",
  cliente_id: "123e4567-e89b-12d3-a456-426614174200",
  encargado_id: "123e4567-e89b-12d3-a456-426614174500",
  hora_inicio: "10:00",
};

describe("CitaCreateSchema — fecha pasada según huso local (ticket 6a7161b4c5a35c889231c8a0)", () => {
  beforeAll(() => {
    process.env.TZ = "America/Santiago";
    // 2026-08-02T01:00:00Z → en Santiago son las 21:00 del 2026-08-01.
    // hoy local = "2026-08-01"; hoy UTC = "2026-08-02".
    jest.useFakeTimers().setSystemTime(new Date("2026-08-02T01:00:00Z"));
  });
  afterAll(() => {
    jest.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  // U-CITA-38 — REGRESIÓN: con hoyISO()=UTC este test fallaba (rechazo
  // espurio de una cita de HOY agendada de noche). Verificado con git stash:
  // sin el fix, safeParse({fecha: "2026-08-01"}) devuelve success=false.
  it("U-CITA-38: agendar para hoy local en la franja 20:00-23:59 (UTC ya es mañana) → success", () => {
    const r = CitaCreateSchema.safeParse({ ...BASE, fecha: "2026-08-01" });
    expect(r.success).toBe(true);
  });

  // U-CITA-39 — la invariante del ticket original se mantiene: una fecha
  // realmente pasada (ayer local) sigue rechazándose con el mismo mensaje.
  it("U-CITA-39: ayer local → fail con mensaje de fecha pasada (validación sigue activa)", () => {
    const r = CitaCreateSchema.safeParse({ ...BASE, fecha: "2026-07-31" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe("No se pueden agendar citas en fechas pasadas");
    }
  });
});
