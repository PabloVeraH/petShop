"use client";

import Link from "next/link";
import { useState } from "react";

export default function HoverPrefetchLink({
  href,
  children,
  className,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const [active, setActive] = useState(false);

  return (
    <Link
      href={href}
      prefetch={active ? null : false}
      onMouseEnter={() => setActive(true)}
      className={className}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}
