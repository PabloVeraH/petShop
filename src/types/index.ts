export interface Producto {
  id: string;
  store_id: string;
  nombre: string;
  sku: string;
  precio: number | null;
  stock: number;           // ahora NUMERIC en BD, sigue siendo number en TS
  stock_minimo: number;
  fecha_vencimiento?: string | null;
  dias_alerta_expira?: number;
  precio_oferta?: number | null;
  en_oferta?: boolean;
  codigo_barra?: string | null;
  precio_venta_kg?: number | null;  // <-- NUEVO
  peso_gramos?: number | null;      // <-- asegurarse que ya esté
  imagen_url?: string | null;
  imagen_url_2?: string | null;
  // Granel (migración 077): gramos del saco abierto; null/ausente = no hay
  // saco abierto. Lo agregan GET /api/productos y GET /api/inventario.
  saco_abierto_gramos?: number | null;
}

export interface Cliente {
  id: string;
  store_id: string;
  rut: string;
  nombre: string;
  email?: string;
  telefono?: string;
}

export interface Mascota {
  id: string;
  cliente_id: string;
  nombre: string;
  tipo: string;
  raza?: string;
  peso_kg?: number;
  alimento_habitual_id?: string;
  gramos_porcion?: number;
  veces_dia?: number;
}

export interface VentaItem {
  id: string;
  venta_id: string;
  // XOR en la BD (migración 068): exactamente uno de producto_id/servicio_id
  // por línea. Las líneas de servicio dejan producto_id en null.
  producto_id: string | null;
  servicio_id?: string | null;
  mascota_id?: string;
  cantidad: number;          // granel: kg (= gramos / 1000)
  precio_unitario: number;   // granel: precio por kg
  subtotal: number;
  es_granel?: boolean;       // migración 077
  gramos?: number | null;    // migración 077 — solo granel (fuente de verdad)
}

export interface Venta {
  id: string;
  store_id: string;
  cliente_id?: string;
  subtotal: number;
  impuesto: number;
  descuento: number;
  total: number;
  estado: "pendiente" | "completada" | "cancelada";
  metodo_pago?: string;
  created_at: string;
}

export interface LoteProducto {
  id: string;
  store_id: string;
  producto_id: string;
  numero_lote?: string | null;
  cantidad_inicial: number;
  cantidad_actual: number;
  fecha_vencimiento: string;
  fecha_ingreso: string;
  orden_compra_id?: string | null;
  notas?: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
  producto?: Pick<Producto, 'id' | 'nombre' | 'sku' | 'stock' | 'dias_alerta_expira'>;
}

export type LoteVencimientoStatus = 'vencido' | 'proximo' | 'vigente';

export interface LoteConStatus extends LoteProducto {
  status: LoteVencimientoStatus;
  diasRestantes: number;
  label: string;
}

export interface VentaItemLote {
  id: string;
  venta_item_id: string;
  lote_id: string;
  cantidad: number;
  created_at: string;
  lote?: LoteProducto;
}

export interface DeduccionFIFOResultado {
  lote_id: string;
  cantidad_deducida: number;
  fecha_ingreso: string;
}

// Migración 074: venta_item_lotes.cantidad y stock_movements.cantidad pasan a
// NUMERIC(10,3) — siguen siendo `number` en TS.

// Resultado de la RPC registrar_lote (migración 076, D11). lote_inicial es el
// "LOTE-0" creado con el stock suelto existente, o null si no hubo conversión.
export interface RegistrarLoteResultado {
  lote: LoteProducto;
  lote_inicial: LoteProducto | null;
}

// Resultado de la RPC ajustar_stock_conteo (migración 076, D22; gramos desde
// 077). cantidad_* son las unidades/sacos CERRADOS (o el lote contado).
export interface AjusteConteoResultado {
  stock_anterior: number;
  stock_nuevo: number;
  cantidad_anterior: number;
  cantidad_contada: number;
  delta: number;
  lote_id: string | null;
  gramos_anterior?: number | null;   // gramos del saco abierto antes (null: no había)
  gramos_contados?: number | null;   // null: no se contaron gramos
}

// Resultado de la RPC merma_lote_vencido (migración 076, D23).
export interface MermaLoteResultado {
  lote: LoteProducto;
  cantidad_baja: number;
}

// ─── Granel: saco abierto (migración 077, §4.6) ──────────────────────────
// gramos_restantes (enteros) es la fuente de verdad; productos.stock =
// sacos cerrados + ROUND(gramos_restantes / peso_gramos, 3).
export type SacoOrigen = "apertura" | "devolucion" | "conteo";
export type SacoMotivoCierre = "agotado" | "merma" | "deshecho" | "conteo";

export interface SacoAbierto {
  id: string;
  store_id: string;
  producto_id: string;
  lote_id: string | null;
  origen: SacoOrigen;
  gramos_iniciales: number;
  gramos_restantes: number;
  abierto_at: string;
  abierto_por: string | null;
  cerrado_at: string | null;
  cerrado_por: string | null;
  motivo_cierre: SacoMotivoCierre | null;
  gramos_merma: number | null;
  nota: string | null;
}

// Trazabilidad venta ↔ saco (migración 077), análoga a VentaItemLote.
export interface VentaItemSaco {
  id: string;
  venta_item_id: string;
  saco_id: string;
  gramos: number;
  created_at: string;
}

// Resultado de POST /api/productos/[id]/saco (RPCs abrir_saco,
// cerrar_saco_merma, deshacer_apertura_saco).
export interface SacoAccionResultado {
  saco: SacoAbierto;
  stock: number;
  gramos_merma?: number;
}

// ─── Servicios agendables (Fase 1) ───────────────────────────────────────
// Ver docs/plan_servicios.md. Fase 1 = solo catálogo + horario semanal;
// sin citas, disponibilidad ni excepciones.

export interface Servicio {
  id: string;
  store_id: string;
  nombre: string;
  descripcion?: string | null;
  duracion_minutos: number;
  // Precio bruto (IVA incluido), AGENTS.md §0.8. NULL para servicios creados
  // antes de la migración 068 — la obligatoriedad es de aplicación (Fase 4).
  precio: number | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

// 1=Lunes ... 7=Domingo (ISO 8601) — NO usar la convención EXTRACT(DOW) de Postgres
export type DiaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ServicioHorario {
  id: string;
  store_id: string;
  servicio_id: string;
  dia_semana: DiaSemana;
  hora_inicio: string; // "HH:MM:SS" tal como lo serializa Postgres TIME al leer
  hora_fin: string;
  created_at: string;
  updated_at: string;
}

export interface ServicioConHorarios extends Servicio {
  servicio_horarios: ServicioHorario[];
}

// ─── Encargados de servicio (Fase 3) ───────────────────────────────────────
// Ver docs/plan_sirvientes.md. Entidad independiente (no reutiliza
// clerk_users/workers). CRUD simple, baja lógica, sin cuenta de sistema.

export interface Encargado {
  id: string;
  store_id: string;
  nombre: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
  citas_totales?: number;      // solo presente en GET /api/encargados (agregado)
  citas_completadas?: number;  // idem
}

// ─── Citas de clientes (Fase 2) ──────────────────────────────────────────
// Ver docs/plan_servicios.md §9-§17. Decisiones §9 aprobadas por el usuario
// el 2026-08-02.

export type CitaEstado = "confirmada" | "cancelada" | "completada" | "no_show";

export interface Cita {
  id: string;
  store_id: string;
  servicio_id: string;
  cliente_id: string;
  mascota_id?: string | null;
  encargado_id?: string | null;
  fecha: string;         // "YYYY-MM-DD"
  hora_inicio: string;   // "HH:MM:SS" tal como lo serializa Postgres TIME al leer
  hora_fin: string;
  duracion_minutos: number;
  // Snapshot de servicios.precio al crear la cita (Fase 4); NULL para citas
  // legado creadas antes de la migración 068.
  precio: number | null;
  // Se llena al completar la cita con pago (completar_cita_tx); queda NULL
  // para citas legado y citas completadas por el camino sin cobro.
  venta_id?: string | null;
  estado: CitaEstado;
  notas?: string | null;
  motivo_cancelacion?: string | null;
  cancelado_at?: string | null;
  cancelado_por?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  cliente?: Pick<Cliente, "nombre" | "telefono">;
  mascota?: Pick<Mascota, "nombre">;
  servicio?: Pick<Servicio, "nombre">;
  encargado?: Pick<Encargado, "nombre">;
}

export interface ServicioExcepcion {
  id: string;
  store_id: string;
  servicio_id: string;
  fecha: string;
  cerrado: boolean;
  hora_inicio?: string | null;
  hora_fin?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SlotDisponible {
  hora_inicio: string; // "HH:MM"
  hora_fin: string;
}

// ─── Canales externos (migración 079, Fase 2 de
// docs/canales-stock/stock_canales_externos.md) ──────────────────────────
// Filas de BD. Los tipos de dominio (EstadoOrden, OrdenNormalizada…) viven en
// src/lib/canales/domain/types.ts.
import type { EstadoOrden, CanalExternoId } from "@/lib/canales/domain/types";

export interface CanalOrdenItemRow {
  sku: string;
  nombre: string | null;
  cantidad: number;
  precio_unitario_bruto: number;
}

export interface CanalOrdenRow {
  id: string;
  store_id: string;
  canal_id: CanalExternoId;
  external_order_id: string;
  estado: EstadoOrden;
  payload: unknown;              // evento crudo de la plataforma
  items: CanalOrdenItemRow[];    // orden normalizada por el adaptador
  total_externo: number | null;
  venta_id: string | null;
  aceptar_antes_de: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  ready_at: string | null;
  motivo_rechazo: string | null;
  intentos: number;
  ultimo_error: string | null;
  created_at: string;
  updated_at: string;
}

export type CanalOutboxTipo = "confirm" | "reject" | "ready" | "availability" | "catalog";
export type CanalOutboxEstado = "pending" | "processing" | "done" | "dead";

export interface CanalOutboxRow {
  id: string;
  store_id: string;
  canal_id: CanalExternoId;
  tipo: CanalOutboxTipo;
  canal_orden_id: string | null;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  estado: CanalOutboxEstado;
  intentos: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

// canal_producto_config (migración 082, Fase 4): catálogo por canal.
// activo = "habilitado en este canal"; precio_override NULL = precio base ×
// recargo del canal (D7). publicado_at NULL = no va en el último catálogo
// publicado (la plataforma no lo conoce).
export interface CanalProductoConfigRow {
  id: string;
  store_id: string;
  canal_id: CanalExternoId;
  producto_id: string;
  precio_override: number | null;
  activo: boolean;
  categoria_canal: string | null;
  descripcion_canal: string | null;
  external_product_id: string | null;
  publicado_at: string | null;
  ultimo_disponible_publicado: boolean | null;
  ultima_cantidad_publicada: number | null; // NULL en canales "toggle"
  disponibilidad_publicada_at: string | null;
  updated_at: string;
}
