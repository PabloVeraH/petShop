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
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
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
