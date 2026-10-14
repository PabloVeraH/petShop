-- 089: contador de rate limit compartido entre instancias.
--
-- src/middleware/rateLimit.ts guardaba los contadores en memoria de cada
-- instancia: en serverless (varias instancias, cold starts) el límite no era
-- global. rate_limit_hit() suma un hit en una ventana fija de forma atómica
-- (INSERT ... ON CONFLICT DO UPDATE toma el lock de la fila) y devuelve el
-- conteo y el fin de la ventana. Si la función no existe o falla, el
-- middleware cae al contador en memoria (limita igual, solo por instancia).
--
-- Solo service_role la ejecuta (el middleware usa createServiceClient). RLS
-- habilitado sin políticas: anon/authenticated no ven la tabla.
-- Idempotente. Reversible: DROP FUNCTION public.rate_limit_hit(text, integer);
-- DROP TABLE public.rate_limit_contadores;

CREATE TABLE IF NOT EXISTS public.rate_limit_contadores (
  clave       text PRIMARY KEY,
  conteo      integer NOT NULL,
  ventana_fin timestamptz NOT NULL
);

ALTER TABLE public.rate_limit_contadores ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_clave text, p_ventana_ms integer)
RETURNS TABLE (conteo integer, ventana_fin timestamptz)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
#variable_conflict use_column
BEGIN
  -- Limpieza oportunista (~1 de cada 1000 hits) de ventanas vencidas hace más
  -- de un día: las claves son IPs y usuarios, la tabla no debe crecer sin fin.
  IF random() < 0.001 THEN
    DELETE FROM public.rate_limit_contadores r
    WHERE r.ventana_fin < now() - interval '1 day';
  END IF;

  RETURN QUERY
  INSERT INTO public.rate_limit_contadores AS r (clave, conteo, ventana_fin)
  VALUES (p_clave, 1, now() + make_interval(secs => p_ventana_ms / 1000.0))
  ON CONFLICT (clave) DO UPDATE SET
    conteo      = CASE WHEN r.ventana_fin <= now() THEN 1 ELSE r.conteo + 1 END,
    ventana_fin = CASE WHEN r.ventana_fin <= now()
                       THEN now() + make_interval(secs => p_ventana_ms / 1000.0)
                       ELSE r.ventana_fin END
  RETURNING r.conteo, r.ventana_fin;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, integer) TO service_role;
REVOKE ALL ON TABLE public.rate_limit_contadores FROM anon, authenticated;
