-- migrations/085_pg_cron_canales.sql
-- Fase 6 — programación de los crons de canales con pg_cron + pg_net
-- (Opción B de stock_canales_externos.md §7.1; D12: Vercel Hobby no permite
-- crons de más de 1 vez/día).
--
-- Estado: NO APLICADA. **Aplicar SOLO DESPUÉS de desplegar la app** con
-- /api/cron/canales-outbox y /api/cron/canales-reconciliar, y con
-- confirmación explícita del usuario (AGENTS.md §0.1 / §11.2).
--
-- Prerrequisitos (NO van en este archivo: son secretos):
--   select vault.create_secret('https://<dominio-produccion>', 'petshop_app_url');
--   select vault.create_secret('<CRON_SECRET de Vercel>',       'petshop_cron_secret');
--   El dominio de producción debe ser público (sin Deployment Protection de
--   Vercel), o pg_net recibe 401/403.
--
-- Plan gratuito de Supabase (verificado 2026-09-25 vía MCP + documentación):
--   - pg_cron 1.6.4 y pg_net 0.20.0 están disponibles en el proyecto (no
--     instaladas); la documentación no los restringe por plan.
--   - Riesgo: los proyectos Free se PAUSAN tras ~7 días de baja actividad; en
--     pausa no corre nada (ni crons ni webhooks). El cron de cada minuto hace
--     que la app consulte la BD, lo que debería contar como actividad, pero
--     Supabase no documenta qué cuenta exactamente — vigilar los emails de
--     aviso de pausa.
--   - cron.job_run_details NO se limpia solo (1.440 filas/día por job de cada
--     minuto) y el plan Free tiene 500 MB: el job 'petshop-canales-limpieza'
--     borra el historial de más de 7 días de los jobs de este archivo.
--
-- Idempotente: cron.schedule con el mismo nombre reemplaza el job.
-- Revertir: select cron.unschedule('petshop-canales-outbox'); (y los otros dos)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Cada minuto: procesa la outbox de canales y barre órdenes atascadas.
select cron.schedule(
  'petshop-canales-outbox',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'petshop_app_url')
               || '/api/cron/canales-outbox',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'petshop_cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- Diario 07:00 UTC (≈ 03:00–04:00 en Chile): reconciliación completa de
-- disponibilidad (lotes/licencias que vencen, canal reactivado, 'dead').
select cron.schedule(
  'petshop-canales-reconciliar',
  '0 7 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'petshop_app_url')
               || '/api/cron/canales-reconciliar',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'petshop_cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- Diario 07:30 UTC: historial de ejecuciones de más de 7 días (solo de estos jobs).
select cron.schedule(
  'petshop-canales-limpieza',
  '30 7 * * *',
  $$
  delete from cron.job_run_details
   where end_time < now() - interval '7 days'
     and jobid in (select jobid from cron.job where jobname like 'petshop-canales-%');
  $$
);
