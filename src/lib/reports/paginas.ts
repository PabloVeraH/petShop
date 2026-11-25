// La API de Supabase devuelve como máximo 1.000 filas por consulta y corta en
// silencio: un reporte con más ventas sumaba de menos.
export const FILAS_POR_PAGINA = 1000;

// Los ids viajan en la URL del request: por lotes para no pasarse del largo.
export const IDS_POR_QUERY = 100;

type Respuesta<T> = { data: T[] | null; error: unknown };

// Lee todas las páginas de una consulta. `pagina` la arma de nuevo cada vez y
// debe llevar un orden estable y .range(desde, hasta). Ante un error no
// devuelve datos a medias: data queda en null.
export async function leerPaginas<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<Respuesta<T>>
): Promise<{ data: T[]; error: null } | { data: null; error: unknown }> {
  const filas: T[] = [];
  for (;;) {
    const { data, error } = await pagina(filas.length, filas.length + FILAS_POR_PAGINA - 1);
    if (error) return { data: null, error };
    filas.push(...(data ?? []));
    if ((data?.length ?? 0) < FILAS_POR_PAGINA) return { data: filas, error: null };
  }
}

export function enLotes<T>(lista: T[], tamano = IDS_POR_QUERY): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}
