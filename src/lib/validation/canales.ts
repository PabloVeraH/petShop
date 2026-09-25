import { z } from "zod";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const fecha = (msg: string) => z.string().regex(FECHA_REGEX, msg);

// Liquidación real de una plataforma (Fase 5, 5.2 — D17/D24). Montos en CLP
// enteros con IVA incluido (AGENTS.md §23.3). monto_neto NO viene del
// cliente: se calcula como monto_bruto − comision. fecha_deposito es
// obligatoria (fecha del asiento; evita asumir "hoy" en UTC).
export const LiquidacionCanalSchema = z
  .object({
    canal_id: z.enum(["rappi", "pedidosya", "ubereats"]),
    periodo_desde: fecha("periodo_desde inválido (YYYY-MM-DD)"),
    periodo_hasta: fecha("periodo_hasta inválido (YYYY-MM-DD)"),
    fecha_deposito: fecha("fecha_deposito inválida (YYYY-MM-DD)"),
    monto_bruto: z.number().int().positive().max(10_000_000_000),
    comision: z.number().int().min(0),
    referencia: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine((d) => d.periodo_desde <= d.periodo_hasta, {
    message: "periodo_desde debe ser anterior o igual a periodo_hasta",
    path: ["periodo_hasta"],
  })
  .refine((d) => d.comision <= d.monto_bruto, {
    message: "La comisión no puede superar el monto bruto",
    path: ["comision"],
  });

export type LiquidacionCanalInput = z.infer<typeof LiquidacionCanalSchema>;
