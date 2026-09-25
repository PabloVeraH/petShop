"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Acceso a los pedidos de canales desde el POS, con el número de pedidos por
// preparar (aceptados automáticamente, D5). Alerta visual de orden nueva (3.8).
export const INTERVALO_AVISO_MS = 20_000;

export default function PedidosCanalesAviso() {
  const [porPreparar, setPorPreparar] = useState(0);

  useEffect(() => {
    let activo = true;
    async function contar() {
      try {
        const res = await fetch("/api/canales/orders?estado=accepted");
        if (!res.ok) return;
        const data = await res.json();
        if (activo && Array.isArray(data)) setPorPreparar(data.length);
      } catch {
        // Sin conexión: se mantiene el último valor; no bloquea el POS.
      }
    }
    contar();
    const id = setInterval(contar, INTERVALO_AVISO_MS);
    return () => {
      activo = false;
      clearInterval(id);
    };
  }, []);

  return (
    <Link
      href="/pos/pedidos"
      className={`rounded-full px-3 py-1 text-sm font-medium ${porPreparar > 0 ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
    >
      Pedidos de canales{porPreparar > 0 ? ` (${porPreparar})` : ""}
    </Link>
  );
}
