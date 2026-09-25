import { z } from "zod";
import { CAMPOS_CREDENCIALES, type CanalConfigurableId } from "./campos";

// Schema Zod de credenciales de un canal, generado desde CAMPOS_CREDENCIALES
// (fuente única con la UI — C5). Todos los campos son obligatorios y no
// pueden ser solo espacios. `extras` permite claves adicionales opcionales
// que el adaptador reconoce (ej. webhook_secret_<EVENTO> en Rappi); cualquier
// otra clave se rechaza para no guardar basura cifrada.
export function schemaCredenciales(
  canal: CanalConfigurableId,
  extras?: RegExp
): z.ZodType<Record<string, string>> {
  const campos = CAMPOS_CREDENCIALES[canal];
  const conocidas = new Set(campos.map((c) => c.key));
  return z
    .record(z.string(), z.string())
    .superRefine((creds, ctx) => {
      for (const campo of campos) {
        if (!creds[campo.key] || creds[campo.key].trim() === "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Falta la credencial: ${campo.label}`,
            path: [campo.key],
          });
        }
      }
      for (const key of Object.keys(creds)) {
        if (conocidas.has(key)) continue;
        if (extras?.test(key) && creds[key].trim() !== "") continue;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Credencial no reconocida: ${key}`,
          path: [key],
        });
      }
    })
    .transform((creds) =>
      Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, v.trim()]))
    );
}

// Claves adicionales aceptadas por canal (ver adapters/rappi/schemas.ts).
export const EXTRAS_CREDENCIALES: Partial<Record<CanalConfigurableId, RegExp>> = {
  rappi: /^webhook_secret_[A-Z_]+$/,
};

export function credencialesValidas(canal: CanalConfigurableId, creds: Record<string, string>): boolean {
  return schemaCredenciales(canal, EXTRAS_CREDENCIALES[canal]).safeParse(creds).success;
}
