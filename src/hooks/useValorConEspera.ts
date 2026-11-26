"use client";

import { useEffect, useState } from "react";

// Espera de los buscadores (POS e inventario). Sin ella, cada carácter
// (también los de la pistola) era una request y una entrada nueva en la caché:
// ~80 % del tráfico de la app y el 429 del rate limit (mascotaspetshop,
// 2026-11-25).
export const ESPERA_BUSQUEDA_MS = 250;

// Devuelve `valor` recién cuando deja de cambiar por `esperaMs`.
export function useValorConEspera<T>(valor: T, esperaMs = ESPERA_BUSQUEDA_MS): T {
  const [conEspera, setConEspera] = useState(valor);
  useEffect(() => {
    const id = setTimeout(() => setConEspera(valor), esperaMs);
    return () => clearTimeout(id);
  }, [valor, esperaMs]);
  return conEspera;
}
