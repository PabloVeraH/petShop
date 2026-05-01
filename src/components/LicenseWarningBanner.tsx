"use client";

import { useState, useEffect } from "react";

interface LicenseWarningBannerProps {
  daysUntilExpiry: number;
  licenseEndDate: string;
}

export function LicenseWarningBanner({ daysUntilExpiry, licenseEndDate }: LicenseWarningBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const key = `license-banner-dismissed-${licenseEndDate}`;
    if (localStorage.getItem(key)) {
      setDismissed(true);
    }
  }, [licenseEndDate]);

  const handleDismiss = () => {
    const key = `license-banner-dismissed-${licenseEndDate}`;
    localStorage.setItem(key, "true");
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-yellow-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-yellow-800">
            <span className="font-medium">Término de período de uso del sistema.</span> Le ruego ponerse en contacto con la administración del sistema. ({daysUntilExpiry} día{daysUntilExpiry !== 1 ? "s" : ""} restante{daysUntilExpiry !== 1 ? "s" : ""})
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="text-yellow-600 hover:text-yellow-800 p-1"
          aria-label="Cerrar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}