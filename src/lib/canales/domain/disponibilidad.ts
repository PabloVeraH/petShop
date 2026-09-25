// Cupo y disponibilidad en canales externos (D4, D16, §4.1, §4.6). Sin I/O.

// D4: cupo = unidades cerradas − stock_minimo. Los canales venden solo
// unidades/sacos enteros (D18): el saco abierto de granel no cuenta, y un
// stock fraccionario heredado se trunca. stock_minimo es nullable (V5).
export function cupoCanalExterno(unidadesCerradas: number, stockMinimo: number | null | undefined): number {
  const cerradas = Math.floor(Math.max(0, Number(unidadesCerradas) || 0) + 1e-9);
  return Math.max(0, cerradas - Math.max(0, Number(stockMinimo ?? 0)));
}

export interface EstadoPublicable {
  productoActivo: boolean;
  habilitadoEnCanal: boolean;
  canalActivo: boolean;
  cupo: number;
}

// §4.1: disponible_en_canal(p, c).
export function disponibleEnCanal(e: EstadoPublicable): boolean {
  return e.productoActivo && e.habilitadoEnCanal && e.canalActivo && e.cupo > 0;
}
