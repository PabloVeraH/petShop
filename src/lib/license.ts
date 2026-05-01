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
  const endDate = new Date(store.license_end_date);
  endDate.setHours(0, 0, 0, 0);

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