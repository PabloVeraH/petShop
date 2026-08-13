import { parseDateOnlyLocal } from "@/lib/dates";

export interface LicenseStatus {
  isAutoBlocked: boolean;
  isInWarningPeriod: boolean;
  daysUntilExpiry: number | null;
  licenseEndDate: string | null;
}

export function computeLicenseStatus(store: {
  license_end_date: string | null;
  license_warning_days: number;
}): LicenseStatus {
  if (!store.license_end_date) {
    return { isAutoBlocked: false, isInWarningPeriod: false, daysUntilExpiry: null, licenseEndDate: null };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Parsear "YYYY-MM-DD" como medianoche local (no UTC) para que hoy === fin
  // sea "último día válido" y el bloqueo ocurra cuando hoy > fin, sin desfase
  // de 1 día por zona horaria (ticket Trello 6a77ef3a0ed45ac54505c62a).
  const endDate = parseDateOnlyLocal(store.license_end_date);

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysUntilExpiry = Math.ceil((endDate.getTime() - today.getTime()) / msPerDay);
  const isAutoBlocked = daysUntilExpiry < 0;
  const isInWarningPeriod = !isAutoBlocked && daysUntilExpiry <= store.license_warning_days;

  return {
    isAutoBlocked,
    isInWarningPeriod,
    daysUntilExpiry: isAutoBlocked ? null : daysUntilExpiry,
    licenseEndDate: store.license_end_date,
  };
}