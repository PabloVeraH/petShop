# Rappi — salida a producción (Fase 6)

Runbook de los pasos 6.1 y 6.2 de `stock_canales_externos.md`. Lo que se
puede verificar desde la app aparece en **Canales → Rappi → Preparación para
producción** (checklist + URLs del webhook). Proyecto Supabase:
`wnxrdbnvreofrrmhcybc` (único entorno: toda escritura requiere confirmación).

## 0. Prerrequisitos externos (no dependen del código)

1. Acceso de partner a la API de integraciones de Rappi (§7.2): contacto
   comercial → credenciales de **desarrollo** (`client_id`, `client_secret`) y
   secreto(s) de webhook. Confirmar con Rappi si una tienda de mascotas va por
   la API de **restaurantes** (la que usa el adaptador) o por la de retail.
2. Despliegue de la app en Vercel con las migraciones 074–085 aplicadas (085
   se aplica **después** del despliegue, ver §3).

## 1. Variables de entorno (Vercel)

| Variable | Desarrollo / preview | Producción |
|----------|----------------------|------------|
| `ENABLED_CHANNELS` | `rappi` | `rappi` |
| `ENCRYPTION_KEY` | obligatoria | obligatoria (la misma que cifró las credenciales) |
| `CRON_SECRET` | obligatoria | obligatoria |
| `RAPPI_API_BASE` | opcional (default: `microservices.dev.rappi.com`) | **obligatoria** (sin default en producción, C19) |
| `RAPPI_AUTH_BASE` | opcional (default: `api.dev.rappi.com`) | **obligatoria** |

## 2. Prueba E2E (6.1)

### 2a. Pipeline propio, sin credenciales de Rappi (simulador)

Con un preview desplegado y el canal configurado con un `webhook_secret` de
prueba (el mismo valor que se pasa al simulador):

```bash
export RAPPI_WEBHOOK_SECRET='<webhook_secret configurado en el canal>'
node scripts/canales/simular-rappi.mjs --url https://<preview>.vercel.app --store-id <uuid-tienda> --evento PING
node scripts/canales/simular-rappi.mjs --url https://<preview>.vercel.app --store-id <uuid-tienda> \
  --evento NEW_ORDER --rappi-store <ID tienda Rappi configurado> --item <SKU>:1:<precio>
node scripts/canales/simular-rappi.mjs --url https://<preview>.vercel.app --store-id <uuid-tienda> \
  --evento ORDER_EVENT_CANCEL --orden <order_id impreso> --rappi-store <ID>
```

Esperado: PING → 200 `{"status":"OK","description":"Store on"}` y el ítem
"Webhook" del checklist en ✓; NEW_ORDER → 201, pedido en `/pos/pedidos`,
venta creada y stock descontado; cancelación → venta anulada y stock
restituido. Las llamadas salientes (confirmar a Rappi) fallan sin credenciales
reales y aparecen en las alertas: es lo esperado en esta etapa.
Si el preview tiene Deployment Protection, agregar `--bypass <token>`.

**Usar un SKU y montos de prueba; anular la venta de prueba al terminar** (los
datos de Supabase son demo pero no deben perderse).

### 2b. Sandbox real de Rappi

1. Ingresar en Canales → Rappi las credenciales de desarrollo (client_id,
   client_secret, ID de tienda, secreto del webhook) y activar el canal.
2. Registrar en el portal de Rappi **una URL por evento** (las muestra el
   checklist, con `?store_id=` y `&evento=`).
3. Verificar el ítem "Webhook" (Rappi envía PING cada 3 min).
4. Habilitar 1–2 productos con `stock_minimo` > 0 y precio, "Publicar
   catálogo"; esperar `MENU_APPROVED` (24–72 h) — ítem "Menú".
5. Crear una orden de prueba en el sandbox: debe aceptarse sola (D5), aparecer
   en `/pos/pedidos`, confirmarse a Rappi (outbox) y poder marcarse lista.
6. Bajar el stock de un producto al mínimo en el POS: debe llegar **una**
   llamada de "apagar" (turn_off); reponer con una OC: **una** de "encender".
7. Cancelar una orden desde el sandbox: venta anulada, stock restituido.

## 3. Crons (pg_cron + pg_net) — también en el plan gratuito

Verificado el 2026-09-25 vía MCP: `pg_cron` 1.6.4 y `pg_net` 0.20.0 están
**disponibles** en el proyecto (aún no instaladas) y `supabase_vault` está
instalado. La documentación de Supabase no los restringe por plan, así que
pueden usarse en el plan gratuito. Pasos, **después** de desplegar:

```sql
select vault.create_secret('https://<dominio-produccion>', 'petshop_app_url');
select vault.create_secret('<CRON_SECRET de Vercel>',       'petshop_cron_secret');
-- luego aplicar migrations/085_pg_cron_canales.sql
```

Verificación: el ítem "Tareas programadas" del checklist, o
`select jobname, schedule, active from cron.job;` y
`select status_code, error_msg from net._http_response order by created desc limit 5;`.

Riesgos del plan gratuito:
- **Pausa por inactividad** (~7 días de baja actividad): en pausa no corre
  nada — ni crons ni webhooks — y las órdenes de Rappi fallarían. El cron de
  cada minuto genera consultas a la BD desde la app, lo que debería contar
  como actividad, pero Supabase no documenta el criterio exacto: **atender
  los emails de aviso de pausa** y, si llega uno, entrar al dashboard.
- 500 MB de base: `cron.job_run_details` no se limpia solo; la 085 incluye un
  job diario que borra el historial de más de 7 días.
- Sin backups descargables en el plan gratuito.

## 4. Checklist go-live (6.2)

Todo en ✓ en "Preparación para producción", más lo que la app no puede ver:

- [ ] `stock_minimo` > 0 en cada producto habilitado (al 2026-09-25: 9 de 14
      productos activos tienen 0 → se apagarían recién sin stock).
- [ ] Credenciales y URLs de **producción** de Rappi (no las de desarrollo).
- [ ] Webhooks registrados en producción apuntando al dominio de producción.
- [ ] Catálogo aprobado en producción.
- [ ] Orden real de bajo monto: aceptada, confirmada, lista, conciliada.
- [ ] Primera liquidación registrada (D24) y cuadrada con el depósito real.
- [ ] Revisar alertas en Canales los primeros días (outbox detenida,
      credenciales, pedidos fallidos, menú).

## 5. PedidosYa / Uber Eats (6.3)

Sin adaptador ("Integración pendiente"). Requieren acceso de partner (§7.2) y
reescribir el adaptador contra la documentación oficial; luego repetir 2.6,
6.1 y 6.2 para cada uno.
