"use client";

import { useEffect, useState } from "react";

// Espera de los buscadores (POS e inventario). Sin ella, cada carácter
// (también los de la pistola) era una request y una entrada nueva en la caché:
// ~80 % del tráfico de la app y el 429 del rate limit (mascotaspetshop,
// 2026-11-25). 500 ms y no 250: en el registro del 2026-11-26 los cajeros
// escribían una letra cada 0,2–0,6 s y con 250 ms casi cada una buscaba.
export const ESPERA_BUSQUEDA_MS = 500;

// Devuelve `valor` recién cuando deja de cambiar por `esperaMs`.
export function useValorConEspera<T>(valor: T, esperaMs = ESPERA_BUSQUEDA_MS): T {
  const [conEspera, setConEspera] = useState(valor);
  useEffect(() => {
    const id = setTimeout(() => setConEspera(valor), esperaMs);
    return () => clearTimeout(id);
  }, [valor, esperaMs]);
  return conEspera;
}
