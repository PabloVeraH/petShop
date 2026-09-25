// Alertas de canales (Fase 5, 5.3). Función pura: clasifica filas ya leídas
// (tenant-scoped por el llamador) en alertas para el admin. Los mensajes de
// error guardados no contienen secretos (outbox.ts / adaptadores).

export type TipoAlerta = "credenciales" | "llamada_detenida" | "llamada_reintentando" | "orden_fallida" | "menu_rechazado";

export interface Alerta {
  tipo: TipoAlerta;
  severidad: "alta" | "media";
  canal_id: string;
  mensaje: string;
  detalle: string | null;
  fecha: string | null;
  outbox_id?: string;   // solo llamadas: permite "Reintentar"
  orden_id?: string;    // solo órdenes fallidas
}

export interface FilaOutboxAlerta {
  id: string;
  canal_id: string;
  tipo: string;
  estado: string;
  intentos: number;
  last_error: string | null;
  updated_at: string | null;
}

export interface FilaOrdenFallida {
  id: string;
  canal_id: string;
  external_order_id: string;
  ultimo_error: string | null;
  updated_at: string | null;
}

export interface FilaConfigMenu {
  canal_id: string;
  menu_detalle: string | null;
  menu_estado_at: string | null;
}

const NOMBRE_TRABAJO: Record<string, string> = {
  confirm: "confirmar un pedido",
  reject: "rechazar un pedido",
  ready: "marcar un pedido listo",
  availability: "actualizar disponibilidad",
  catalog: "publicar el catálogo",
};

// Credenciales inválidas, token rechazado o sin permiso: no se arregla
// reintentando, requiere revisar la configuración del canal.
export function esErrorCredenciales(mensaje: string | null): boolean {
  if (!mensaje) return false;
  return (
    mensaje.startsWith("Credenciales del canal inválidas") ||
    mensaje.includes("autenticación rechazada") ||
    /respondió 40[13]\b/.test(mensaje)
  );
}

export function armarAlertas(
  outbox: FilaOutboxAlerta[],
  ordenes: FilaOrdenFallida[],
  menus: FilaConfigMenu[]
): Alerta[] {
  const alertas: Alerta[] = [];

  // Una alerta de credenciales por canal (no una por llamada).
  const canalesConCredenciales = new Set<string>();
  for (const j of outbox) {
    if (esErrorCredenciales(j.last_error) && !canalesConCredenciales.has(j.canal_id)) {
      canalesConCredenciales.add(j.canal_id);
      alertas.push({
        tipo: "credenciales",
        severidad: "alta",
        canal_id: j.canal_id,
        mensaje: "La plataforma rechaza las credenciales o el token: revisa la configuración del canal",
        detalle: j.last_error,
        fecha: j.updated_at,
      });
    }
  }

  for (const j of outbox) {
    const accion = NOMBRE_TRABAJO[j.tipo] ?? j.tipo;
    alertas.push(
      j.estado === "dead"
        ? {
            tipo: "llamada_detenida",
            severidad: "alta",
            canal_id: j.canal_id,
            mensaje: `No se pudo ${accion} tras ${j.intentos} intentos`,
            detalle: j.last_error,
            fecha: j.updated_at,
            outbox_id: j.id,
          }
        : {
            tipo: "llamada_reintentando",
            severidad: "media",
            canal_id: j.canal_id,
            mensaje: `Reintentando ${accion} (${j.intentos} intentos)`,
            detalle: j.last_error,
            fecha: j.updated_at,
          }
    );
  }

  for (const o of ordenes) {
    alertas.push({
      tipo: "orden_fallida",
      severidad: "alta",
      canal_id: o.canal_id,
      mensaje: `El pedido ${o.external_order_id} no se pudo procesar`,
      detalle: o.ultimo_error,
      fecha: o.updated_at,
      orden_id: o.id,
    });
  }

  for (const m of menus) {
    alertas.push({
      tipo: "menu_rechazado",
      severidad: "alta",
      canal_id: m.canal_id,
      mensaje: "La plataforma rechazó el catálogo publicado",
      detalle: m.menu_detalle,
      fecha: m.menu_estado_at,
    });
  }

  return alertas;
}
