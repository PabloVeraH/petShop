import { timingSafeEqual } from "crypto";

// Autenticación de crons (AGENTS.md §14): Authorization: Bearer $CRON_SECRET,
// comparado en tiempo constante. Sin CRON_SECRET configurado → siempre
// rechaza (nunca acepta "Bearer undefined").
export function cronAutorizado(req: { headers: Headers }): boolean {
  const secreto = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secreto) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secreto}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
