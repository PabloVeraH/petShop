/**
 * Supabase simulado con una consulta por llamada a from(): cada consulta
 * registra sus operaciones (select/eq/update/…) y se resuelve con
 * `resolver(tabla, ops)` al hacer await (o en maybeSingle/single). Permite
 * probar flujos con varias consultas en secuencia y verificar los filtros de
 * tenant y de estado de cada una.
 */
export interface Op {
  m: string;
  a: unknown[];
}

export interface Consulta {
  tabla: string;
  ops: Op[];
}

export type Resultado = { data?: unknown; error?: unknown };

export function crearFakeSupabase(resolver: (tabla: string, ops: Op[]) => Resultado) {
  const consultas: Consulta[] = [];
  const rpc = jest.fn();

  function from(tabla: string) {
    const ops: Op[] = [];
    consultas.push({ tabla, ops });
    const resolver_ = () => Promise.resolve({ data: null, error: null, ...resolver(tabla, ops) });
    const builder: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => resolver_().then(ok, ko);
          }
          return (...a: unknown[]) => {
            ops.push({ m: String(prop), a });
            if (prop === "maybeSingle" || prop === "single") return resolver_();
            return builder;
          };
        },
      }
    );
    return builder;
  }

  return { client: { from, rpc } as unknown as import("@supabase/supabase-js").SupabaseClient, consultas, rpc };
}

// Utilidades para leer las operaciones registradas.
export const tiene = (ops: Op[], m: string, ...a: unknown[]) =>
  ops.some((o) => o.m === m && a.every((v, i) => JSON.stringify(o.a[i]) === JSON.stringify(v)));
export const argsDe = (ops: Op[], m: string) => ops.find((o) => o.m === m)?.a;
