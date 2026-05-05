import type { LoteProducto, LoteConStatus, LoteVencimientoStatus } from '@/types';

export function getLoteStatus(
  fechaVencimiento: string,
  diasAlerta = 30
): { status: LoteVencimientoStatus; diasRestantes: number; label: string } {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const vence = new Date(fechaVencimiento + 'T00:00:00');
  const diff = Math.floor((vence.getTime() - hoy.getTime()) / 86_400_000);

  if (diff < 0)          return { status: 'vencido',  diasRestantes: diff, label: 'Vencido' };
  if (diff <= diasAlerta) return { status: 'proximo',  diasRestantes: diff, label: `Vence en ${diff}d` };
  return                         { status: 'vigente',  diasRestantes: diff, label: `Vence en ${diff}d` };
}

export function enriquecerLotes(lotes: LoteProducto[], diasAlerta = 30): (LoteProducto & { status: LoteVencimientoStatus; diasRestantes: number; label: string })[] {
  return lotes.map(l => ({ ...l, ...getLoteStatus(l.fecha_vencimiento, diasAlerta) }));
}

export function clasificarLotes(lotes: LoteProducto[], diasAlerta = 30) {
  const e = enriquecerLotes(lotes, diasAlerta);
  return {
    vencidos: e.filter(l => l.status === 'vencido'),
    proximos: e.filter(l => l.status === 'proximo'),
    vigentes: e.filter(l => l.status === 'vigente'),
  };
}

export function productoTieneLotes(lotes: LoteProducto[]): boolean {
  return lotes.some(l => l.activo);
}