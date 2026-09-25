// Checklist de salida a producción de un canal (Fase 6, paso 6.2 del plan
// docs/canales-stock/stock_canales_externos.md). Función pura: evalúa datos
// ya leídos (tenant-scoped por el llamador). Nunca recibe ni devuelve
// valores de secretos: solo si están configurados.

export type EstadoItem = "ok" | "pendiente" | "error";

export interface ItemPreparacion {
  id: string;
  titulo: string;
  estado: EstadoItem;
  detalle: string;
}

export interface DatosPreparacion {
  produccion: boolean;                 // NODE_ENV === "production"
  adaptadorDesplegado: boolean;        // implementado + en ENABLED_CHANNELS
  env: { encryptionKey: boolean; cronSecret: boolean; apiBase: boolean; authBase: boolean };
  habilitadoGlobal: boolean;           // canales_externos.habilitado
  licenciaVigente: boolean;
  config: {
    existe: boolean;
    activo: boolean;
    credenciales: "ok" | "faltan" | "invalidas";
    externalStoreId: boolean;
    ultimoEventoAt: string | null;
    ultimoEventoTipo: string | null;
    menuEstado: string | null;
    menuDetalle: string | null;
  };
  productos: { habilitados: number; publicados: number; sinMinimo: string[] };
  crons: { jobname: string; active: boolean }[];
  outboxMuertos: number;
  ahoraMs: number;
}

// Rappi envía PING cada 3 minutos: sin eventos en 15 min, algo está mal.
export const MINUTOS_EVENTO_RECIENTE = 15;
export const CRONS_REQUERIDOS = ["petshop-canales-outbox", "petshop-canales-reconciliar"] as const;
const MAX_NOMBRES = 10;

export function evaluarPreparacion(d: DatosPreparacion): ItemPreparacion[] {
  const items: ItemPreparacion[] = [];
  const add = (id: string, titulo: string, estado: EstadoItem, detalle: string) => items.push({ id, titulo, estado, detalle });

  add(
    "despliegue",
    "Integración habilitada en el despliegue",
    d.adaptadorDesplegado ? "ok" : "error",
    d.adaptadorDesplegado ? "El canal está en ENABLED_CHANNELS." : "Agregar el canal a ENABLED_CHANNELS en las variables de entorno."
  );

  const faltanEnv = [
    !d.env.encryptionKey && "ENCRYPTION_KEY",
    !d.env.cronSecret && "CRON_SECRET",
    d.produccion && !d.env.apiBase && "URL base de la API de la plataforma",
    d.produccion && !d.env.authBase && "URL base de autenticación de la plataforma",
  ].filter(Boolean) as string[];
  add(
    "entorno",
    "Variables de entorno",
    faltanEnv.length ? "error" : d.produccion ? "ok" : "pendiente",
    faltanEnv.length
      ? `Faltan: ${faltanEnv.join(", ")}.`
      : d.produccion
        ? "Configuradas."
        : "Entorno de desarrollo: sin URLs de producción se usa el ambiente de pruebas de la plataforma."
  );

  add(
    "global",
    "Canal habilitado globalmente",
    d.habilitadoGlobal ? "ok" : "error",
    d.habilitadoGlobal ? "canales_externos.habilitado = true." : "Un administrador del sistema debe habilitar el canal (canales_externos.habilitado)."
  );

  add(
    "licencia",
    "Licencia de la tienda vigente",
    d.licenciaVigente ? "ok" : "error",
    d.licenciaVigente ? "Vigente." : "Licencia vencida: todos los productos se publican apagados (D15)."
  );

  const c = d.config;
  add(
    "config",
    "Canal configurado y activo",
    c.existe && c.activo ? "ok" : "error",
    !c.existe ? "Configura el canal (credenciales)." : c.activo ? "Activo." : "El canal está inactivo."
  );
  add(
    "credenciales",
    "Credenciales válidas e ID de tienda",
    c.credenciales === "ok" && c.externalStoreId ? "ok" : "error",
    c.credenciales === "faltan"
      ? "No hay credenciales guardadas."
      : c.credenciales === "invalidas"
        ? "Las credenciales guardadas no son válidas: vuelve a ingresarlas."
        : c.externalStoreId
          ? "Credenciales completas."
          : "Falta el ID de la tienda en la plataforma."
  );

  const minutos = c.ultimoEventoAt ? (d.ahoraMs - Date.parse(c.ultimoEventoAt)) / 60_000 : null;
  add(
    "webhook",
    "Webhook registrado y recibiendo eventos",
    minutos == null ? "pendiente" : minutos <= MINUTOS_EVENTO_RECIENTE ? "ok" : "error",
    minutos == null
      ? "Aún no llega ningún evento firmado: registra las URLs del webhook en la plataforma."
      : minutos <= MINUTOS_EVENTO_RECIENTE
        ? `Último evento (${c.ultimoEventoTipo ?? "?"}) hace ${Math.max(0, Math.round(minutos))} min.`
        : `Sin eventos hace ${Math.round(minutos)} min (la plataforma envía PING cada 3 min): revisa la URL y el secreto.`
  );

  const p = d.productos;
  add(
    "catalogo",
    "Catálogo publicado",
    p.habilitados === 0 ? "error" : p.publicados === 0 ? "pendiente" : "ok",
    p.habilitados === 0
      ? "No hay productos habilitados para el canal."
      : p.publicados === 0
        ? `${p.habilitados} habilitados, ninguno publicado: usa "Publicar catálogo".`
        : `${p.publicados} de ${p.habilitados} habilitados publicados.`
  );
  add(
    "menu",
    "Menú aprobado por la plataforma",
    c.menuEstado === "aprobado" ? "ok" : c.menuEstado === "rechazado" ? "error" : "pendiente",
    c.menuEstado === "aprobado"
      ? "Aprobado."
      : c.menuEstado === "rechazado"
        ? `Rechazado${c.menuDetalle ? `: ${c.menuDetalle}` : ""}.`
        : c.menuEstado === "enviado"
          ? "En revisión (la plataforma tarda 24–72 h)."
          : "Aún no se publica el catálogo."
  );
  add(
    "stock_minimo",
    "Stock mínimo definido",
    p.sinMinimo.length ? "pendiente" : "ok",
    p.sinMinimo.length
      ? `${p.sinMinimo.length} producto(s) habilitados con mínimo 0: se apagan recién sin stock (${p.sinMinimo.slice(0, MAX_NOMBRES).join(", ")}${p.sinMinimo.length > MAX_NOMBRES ? ", …" : ""}).`
      : "Todos los productos habilitados tienen mínimo."
  );

  const activos = new Set(d.crons.filter((j) => j.active).map((j) => j.jobname));
  const faltanCrons = CRONS_REQUERIDOS.filter((n) => !activos.has(n));
  add(
    "crons",
    "Tareas programadas (pg_cron)",
    faltanCrons.length ? "pendiente" : "ok",
    faltanCrons.length
      ? `Sin programar: ${faltanCrons.join(", ")} (migración 085, después del despliegue).`
      : "Outbox cada minuto y reconciliación diaria activas."
  );

  add(
    "outbox",
    "Sin llamadas detenidas",
    d.outboxMuertos > 0 ? "error" : "ok",
    d.outboxMuertos > 0 ? `${d.outboxMuertos} llamada(s) detenidas: revisa las alertas en Canales.` : "Ninguna."
  );

  return items;
}

export function listoParaProduccion(items: ItemPreparacion[]): boolean {
  return items.every((i) => i.estado === "ok");
}
