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

  it("LC-05: exactamente en el día de vencimiento → isAutoBlocked=true", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = computeLicenseStatus({
      license_end_date: today.toISOString().split("T")[0],
      license_warning_days: 7,
    });
    expect(result.isAutoBlocked).toBe(true);
    expect(result.daysUntilExpiry).toBe(null);
  });

  it("LC-06: exactamente en día de aviso → isInWarningPeriod=true", () => {
    const warningDay = new Date();
    warningDay.setDate(warningDay.getDate() + 7);
    const result = computeLicenseStatus({
      license_end_date: warningDay.toISOString().split("T")[0],
      license_warning_days: 7,
    });
    expect(result.isAutoBlocked).toBe(false);
    expect(result.isInWarningPeriod).toBe(true);
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