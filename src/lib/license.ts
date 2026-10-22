import { diasEntreISO, hoyNegocioISO } from "@/lib/dates";

export interface LicenseStatus {
  isAutoBlocked: boolean;
  isInWarningPeriod: boolean;
  daysUntilExpiry: number | null;
  licenseEndDate: string | null;
}

export function computeLicenseStatus(store: {
  license_end_date: string | null;
  license_warning_days: number;
}, ahora: Date = new Date()): LicenseStatus {
  if (!store.license_end_date) {
    return { isAutoBlocked: false, isInWarningPeriod: false, daysUntilExpiry: null, licenseEndDate: null };
  }

  // Días de calendario entre "hoy" de Chile y el fin ("YYYY-MM-DD", último día
  // válido): hoy === fin → 0, el bloqueo ocurre cuando hoy > fin. Antes "hoy"
  // salía de setHours(0,0,0,0) en el huso del proceso (UTC en Vercel), así que
  // el último día la licencia se bloqueaba desde las ~21:00 de Chile.
  const daysUntilExpiry = diasEntreISO(hoyNegocioISO(ahora), store.license_end_date);
  const isAutoBlocked = daysUntilExpiry < 0;
  const isInWarningPeriod = !isAutoBlocked && daysUntilExpiry <= store.license_warning_days;

  return {
    isAutoBlocked,
    isInWarningPeriod,
    daysUntilExpiry: isAutoBlocked ? null : daysUntilExpiry,
    licenseEndDate: store.license_end_date,
  };
}
