/**
 * Tests for license control functionality
 */
import { computeLicenseStatus } from "@/lib/license";
import { LicenseConfigSchema, UserDisableSchema } from "@/lib/validation";

describe("computeLicenseStatus", () => {
  it("LC-01: sin license_end_date → no bloqueo, no warning", () => {
    const result = computeLicenseStatus({
      license_end_date: null,
      license_warning_days: 7,
    });
    expect(result.isAutoBlocked).toBe(false);
    expect(result.isInWarningPeriod).toBe(false);
    expect(result.daysUntilExpiry).toBe(null);
  });

  it("LC-02: fecha futura fuera de rango de aviso → no warning, no bloqueo", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 31);
    futureDate.setHours(23, 59, 59, 999);
    const result = computeLicenseStatus({
      license_end_date: futureDate.toISOString().split("T")[0],
      license_warning_days: 7,
    });
    expect(result.isAutoBlocked).toBe(false);
    expect(result.isInWarningPeriod).toBe(false);
    expect(result.daysUntilExpiry).toBeGreaterThanOrEqual(30);
  });

  it("LC-03: dentro del período de aviso → isInWarningPeriod=true", () => {
    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + 5);
    warningDate.setHours(23, 59, 59, 999);
    const result = computeLicenseStatus({
      license_end_date: warningDate.toISOString().split("T")[0],
      license_warning_days: 7,
    });
    expect(result.isAutoBlocked).toBe(false);
    expect(result.isInWarningPeriod).toBe(true);
    expect(result.daysUntilExpiry).toBeGreaterThanOrEqual(4);
  });

  it("LC-04: fecha vencida → isAutoBlocked=true, daysUntilExpiry=null", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);
    const result = computeLicenseStatus({
      license_end_date: pastDate.toISOString().split("T")[0],
      license_warning_days: 7,
    });
    expect(result.isAutoBlocked).toBe(true);
    expect(result.isInWarningPeriod).toBe(false);
    expect(result.daysUntilExpiry).toBe(null);
  });

  // LC-05 (CORREGIDO, ticket 6a77ef3a): fin = HOY → último día válido → NO
  // bloqueo y daysUntilExpiry = 0. El test anterior afirmaba bloqueado el día
  // del vencimiento porque el parseo UTC desplazaba el fin al día anterior
  // (el bug); el contrato del middleware ("Si hoy > este valor el middleware
  // bloquea acceso") exige bloqueo cuando hoy > fin, es decir, al día siguiente.
  it("LC-05: fin = hoy (fecha local) → no bloqueo, daysUntilExpiry = 0", () => {
    const result = computeLicenseStatus({
      license_end_date: localDateString(new Date()),
      license_warning_days: 7,
    });
    expect(result.isAutoBlocked).toBe(false);
    expect(result.daysUntilExpiry).toBe(0);
  });

  // LC-06 (CORREGIDO, ticket 6a77ef3a): fin = hoy + 7 días → día de aviso →
  // isInWarningPeriod=true. Construido con partes locales para no depender de
  // la hora del día en que corre el test (toISOString desplaza por zona).
  it("LC-06: fin = hoy + warning_days (fecha local) → isInWarningPeriod=true", () => {
    const result = computeLicenseStatus({
      license_end_date: localDateString(addDays(new Date(), 7)),
      license_warning_days: 7,
    });
    expect(result.isAutoBlocked).toBe(false);
    expect(result.isInWarningPeriod).toBe(true);
  });
});

// Tickets Trello 6a77ef3a0ed45ac54505c62a — desfase de 1 día en fechas de
// licencia. `computeLicenseStatus` parseaba license_end_date ("YYYY-MM-DD",
// columna DATE) con new Date("...") = medianoche UTC; en América/Santiago
// (UTC-3/-4) la fecha quedaba 1 día antes y el bloqueo/aviso se activaba un
// día antes. Las fechas fecha-local se construyen con partes locales (no
// toISOString, que desplaza por zona horaria) para que el test sea
// independiente del huso del runner.
function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

describe("computeLicenseStatus — desfase de 1 día por zona horaria (ticket 6a77ef3a)", () => {
  // LC-17: REGRESIÓN — licencia que vence HOY (último día válido, hoy === fin)
  // no debe bloquear: el auto-bloqueo es cuando hoy > fin (contrato del
  // middleware: "Si hoy > este valor el middleware bloquea acceso"). También
  // debe estar en período de aviso. Antes del fix el fin se leía como "ayer"
  // y el ítem quedaba bloquedado el mismo día del vencimiento.
  it("LC-17: fin = hoy → no bloqueo, en período de aviso (hoy es el último día válido)", () => {
    const result = computeLicenseStatus({
      license_end_date: localDateString(new Date()),
      license_warning_days: 7,
    });
    expect(result.isAutoBlocked).toBe(false);
    expect(result.isInWarningPeriod).toBe(true);
  });

  // LC-18: fin = ayer → bloqueado (también se cubre MW-14)
  it("LC-18: fin = ayer → isAutoBlocked=true", () => {
    const result = computeLicenseStatus({
      license_end_date: localDateString(addDays(new Date(), -1)),
      license_warning_days: 7,
    });
    expect(result.isAutoBlocked).toBe(true);
    expect(result.daysUntilExpiry).toBe(null);
  });

  // LC-19: fin = hoy + dias_aviso → empieza el período de aviso (límite)
  it("LC-19: fin = hoy + warning_days → isInWarningPeriod=true, no bloqueo", () => {
    const result = computeLicenseStatus({
      license_end_date: localDateString(addDays(new Date(), 7)),
      license_warning_days: 7,
    });
    expect(result.isAutoBlocked).toBe(false);
    expect(result.isInWarningPeriod).toBe(true);
  });

  // LC-20: REGRESIÓN — fin = hoy + warning_days + 1 → aún NO está en el
  // período de aviso. Antes del fix el límite se desplazaba 1 día antes y
  // este día ya caía dentro del aviso.
  it("LC-20: fin = hoy + warning_days + 1 → aún NO en aviso", () => {
    const result = computeLicenseStatus({
      license_end_date: localDateString(addDays(new Date(), 8)),
      license_warning_days: 7,
    });
    expect(result.isAutoBlocked).toBe(false);
    expect(result.isInWarningPeriod).toBe(false);
  });

  // LC-21: días restantes coinciden con el valor de la columna (sin desfase)
  it("LC-21: fin = hoy + 10 → daysUntilExpiry = 10 (sin desplazamiento de zona)", () => {
    const result = computeLicenseStatus({
      license_end_date: localDateString(addDays(new Date(), 10)),
      license_warning_days: 7,
    });
    expect(result.daysUntilExpiry).toBe(10);
  });
});

describe("LicenseConfigSchema", () => {
  it("LC-07: acepta fechas válidas", () => {
    const result = LicenseConfigSchema.safeParse({
      license_start_date: "2026-01-01",
      license_end_date: "2026-12-31",
      license_warning_days: 14,
    });
    expect(result.success).toBe(true);
  });

  it("LC-08: license_start_date > license_end_date → inválido", () => {
    const result = LicenseConfigSchema.safeParse({
      license_start_date: "2026-12-31",
      license_end_date: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("LC-09: license_warning_days > 90 → inválido", () => {
    const result = LicenseConfigSchema.safeParse({
      license_warning_days: 91,
    });
    expect(result.success).toBe(false);
  });

  it("LC-10: license_warning_days < 1 → inválido", () => {
    const result = LicenseConfigSchema.safeParse({
      license_warning_days: 0,
    });
    expect(result.success).toBe(false);
  });

  it("LC-11: acepta valores nulos opcionales", () => {
    const result = LicenseConfigSchema.safeParse({
      license_start_date: null,
      license_end_date: null,
    });
    expect(result.success).toBe(true);
  });

  it("LC-12: acepta formato de fecha incorrecto", () => {
    const result = LicenseConfigSchema.safeParse({
      license_end_date: "31-12-2026",
    });
    expect(result.success).toBe(false);
  });
});

describe("UserDisableSchema", () => {
  it("LC-13: acepta userIds y action válidos", () => {
    const result = UserDisableSchema.safeParse({
      userIds: ["user-1", "user-2"],
      action: "disable",
    });
    expect(result.success).toBe(true);
  });

  it("LC-14: userIds vacío → inválido", () => {
    const result = UserDisableSchema.safeParse({
      userIds: [],
      action: "disable",
    });
    expect(result.success).toBe(false);
  });

  it("LC-15: action inválido → inválido", () => {
    const result = UserDisableSchema.safeParse({
      userIds: ["user-1"],
      action: "delete",
    });
    expect(result.success).toBe(false);
  });

  it("LC-16: acepta action: enable", () => {
    const result = UserDisableSchema.safeParse({
      userIds: ["user-1"],
      action: "enable",
    });
    expect(result.success).toBe(true);
  });
});