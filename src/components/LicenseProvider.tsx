"use client";

import { useQuery } from "@tanstack/react-query";
import { LicenseWarningBanner } from "./LicenseWarningBanner";

export function LicenseProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery<{
    status: { isInWarningPeriod: boolean; daysUntilExpiry: number | null; licenseEndDate: string | null };
  }>({
    queryKey: ["license-status"],
    queryFn: () => fetch("/api/admin/license").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const showBanner = data?.status?.isInWarningPeriod && data?.status?.daysUntilExpiry != null && data?.status?.licenseEndDate;

  return (
    <>
      {showBanner && (
        <LicenseWarningBanner
          daysUntilExpiry={data.status.daysUntilExpiry!}
          licenseEndDate={data.status.licenseEndDate!}
        />
      )}
      {children}
    </>
  );
}