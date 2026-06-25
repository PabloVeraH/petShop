"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

const SECTION_LABELS: Record<string, string> = {
  "/pos":          "POS",
  "/dashboard":    "Analítica",
  "/customers":    "Clientes",
  "/inventory":    "Inventario",
  "/sales":        "Ventas",
  "/vendedores":   "Vendedores",
  "/suppliers":    "Proveedores",
  "/contabilidad": "Libro Diario",
  "/canales":      "Canales",
  "/settings":     "Configuración",
  "/admin":        "Admin",
};

export default function AccesoDenegadoPage() {
  const searchParams = useSearchParams();
  const fromParam = searchParams.get("from");
  const fromDecoded = fromParam ? decodeURIComponent(fromParam) : null;
  const sectionLabel = fromDecoded ? (SECTION_LABELS[fromDecoded] ?? fromDecoded) : null;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-6" aria-hidden>
        <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-gray-800 mb-2">Acceso denegado</h1>

      <p className="text-gray-500 mb-8 max-w-sm">
        {sectionLabel ? (
          <>
            Tu rol actual no tiene permiso para acceder a{" "}
            <span className="font-semibold text-gray-700">{sectionLabel}</span>.{" "}
            Contacta a un administrador si necesitas acceso a esta sección.
          </>
        ) : (
          <>
            Tu rol actual no tiene permiso para acceder a esta sección.
            Contacta a un administrador si necesitas acceso.
          </>
        )}
      </p>

      <Link
        href="/pos"
        className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors"
      >
        Volver al POS
      </Link>
    </div>
  );
}
