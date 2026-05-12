export interface Producto {
  id: string;
  store_id: string;
  nombre: string;
  sku: string;
  precio: number | null;
  stock: number;
  stock_minimo: number;
  fecha_vencimiento?: string | null;
  dias_alerta_expira?: number;
  precio_oferta?: number | null;
  en_oferta?: boolean;
  codigo_barra?: string | null;
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
  producto_id: string;
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
