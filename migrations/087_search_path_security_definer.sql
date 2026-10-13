-- 087: fija search_path en las 3 funciones SECURITY DEFINER que no lo tenían.
--
-- Una función SECURITY DEFINER corre con los privilegios de su dueño; sin
-- search_path fijo resuelve nombres sin calificar según el search_path de
-- quien la llama, que podría anteponer un esquema propio con objetos
-- homónimos (advisor de Supabase "function_search_path_mutable"). El resto de
-- las funciones SECURITY DEFINER del esquema ya usan 'public', 'pg_temp'.
--
-- Idempotente: ALTER FUNCTION ... SET reemplaza el valor si ya existe.
-- Reversible: ALTER FUNCTION ... RESET search_path.

ALTER FUNCTION public.replace_servicio_horarios(uuid, uuid, jsonb)
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.cancelar_cita_tx(uuid, uuid, text, text)
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.crear_venta_tx(uuid, jsonb, uuid, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, text, jsonb, integer, text, text)
  SET search_path TO 'public', 'pg_temp';
