/**
 * Tests U-CITA-38/39: CitaCreateSchema — "hoy" se calcula en el huso horario
 * del NEGOCIO (America/Santiago, vía Intl.DateTimeFormat con timeZone fijo),
 * nunca según el huso del proceso Node (ticket 6a7161b4c5a35c889231c8a0).
 *
 * Contexto — corregido tras revisión de un fix previo de este mismo ticket:
 * ese primer intento cambió hoyISO() de `toISOString().split("T")[0]` (UTC) a
 * getters "locales" (getFullYear/Month/Date), asumiendo que reflejarían la
 * hora de Chile. Eso es FALSO en producción: las Vercel Functions corren
 * SIEMPRE con TZ=UTC — `TZ` es una variable de entorno reservada por Vercel,
 * no configurable desde project settings
 * (https://vercel.com/docs/environment-variables/reserved-environment-variables),
 * heredada de AWS Lambda (infraestructura subyacente), sin excepción sin
 * importar la región del deployment. "Hora local del proceso" == UTC en el
 * deploy real, así que ese primer fix no cambiaba nada: el rechazo espurio de
 * "hoy" durante la franja nocturna de Chile seguía ocurriendo en producción.
 *
 * Este test NO manipula `process.env.TZ` (a diferencia de un primer intento
 * de test para este mismo bug): V8/ICU cachea el offset de zona horaria tras
 * la primera operación Date del proceso, así que reasignar `process.env.TZ`
 * a mitad de un proceso ya iniciado NO es confiable — verificado
 * empíricamente (falla en simular la divergencia según qué TZ tenía el
 * proceso al arrancar; mismo caveat ya documentado en
 * tests/unit/citas/date-utils.test.ts para el equivalente de frontend). El
 * fix usa Intl.DateTimeFormat con timeZone explícito, que ignora
 * process.env.TZ por completo — por eso el test tampoco necesita tocarlo:
 * el resultado es correcto sin importar el TZ real del proceso.
 *
 * Verificación de la regresión (no repetible por el test en sí, documentada
 * aquí): ejecutando la suite con `TZ=UTC` fijado ANTES de iniciar Node (el
 * único mecanismo confiable para simular el TZ real de producción), el
 * código anterior a este fix (getters locales) hace fallar U-CITA-38; con
 * este fix, pasa.
 */
import { CitaCreateSchema } from "@/lib/validation/citas";

const BASE = {
  servicio_id: "123e4567-e89b-12d3-a456-426614174100",
  cliente_id: "123e4567-e89b-12d3-a456-426614174200",
  encargado_id: "123e4567-e89b-12d3-a456-426614174500",
  hora_inicio: "10:00",
};

// 2026-08-02T01:00:00Z → en Santiago (UTC-4) son las 21:00 del 2026-08-01.
// "hoy" para el negocio (Chile) = "2026-08-01"; "hoy" en UTC = "2026-08-02".
const AHORA = new Date("2026-08-02T01:00:00Z");

describe("CitaCreateSchema — fecha pasada según huso del negocio (Chile), no el del proceso", () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(AHORA);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  // U-CITA-38 — REGRESIÓN: con hoyISO() en UTC (código original del ticket,
  // y también el primer intento de fix con getters "locales" — que en
  // Vercel TAMBIÉN es UTC, ver contexto arriba) este caso fallaba
  // espuriamente en producción.
  it("U-CITA-38: agendar para hoy de Chile en franja nocturna (UTC ya cruzó la medianoche) → success", () => {
    const r = CitaCreateSchema.safeParse({ ...BASE, fecha: "2026-08-01" });
    expect(r.success).toBe(true);
  });

  // U-CITA-39 — la invariante del ticket original se mantiene: una fecha
  // realmente pasada para Chile (ayer local de Chile) sigue rechazándose.
  it("U-CITA-39: ayer de Chile → fail con mensaje de fecha pasada (validación sigue activa)", () => {
    const r = CitaCreateSchema.safeParse({ ...BASE, fecha: "2026-07-31" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe("No se pueden agendar citas en fechas pasadas");
    }
  });
});
