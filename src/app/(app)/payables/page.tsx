"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function PayablesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/suppliers");
  }, [router]);

  return null;
}
