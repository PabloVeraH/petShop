"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Acceso a los pedidos de canales desde el POS, con el número de pedidos por
// preparar (aceptados automáticamente, D5). Alerta visual de orden nueva (3.8).
// Solo pregunta si la tienda tiene un canal de pedidos activo (`activo`, de
// GET /api/tienda/nombre); si no, el enlace queda sin contador.
export const INTERVALO_AVISO_MS = 20_000;

export default function PedidosCanalesAviso({ activo }: { activo: boolean }) {
  const [porPreparar, setPorPreparar] = useState(0);

  useEffect(() => {
    if (!activo) return;
    let montado = true;
    async function contar() {
      try {
        const res = await fetch("/api/canales/orders?estado=accepted");
        if (!res.ok) return;
        const data = await res.json();
        if (montado && Array.isArray(data)) setPorPreparar(data.length);
      } catch {
        // Sin conexión: se mantiene el último valor; no bloquea el POS.
      }
    }
    contar();
    const id = setInterval(contar, INTERVALO_AVISO_MS);
    return () => {
      montado = false;
      clearInterval(id);
    };
  }, [activo]);

  return (
    <Link
      href="/pos/pedidos"
      className={`rounded-full px-3 py-1 text-sm font-medium ${porPreparar > 0 ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
    >
      Pedidos de canales{porPreparar > 0 ? ` (${porPreparar})` : ""}
    </Link>
  );
}
