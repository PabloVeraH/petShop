export interface Producto {
  id: string;
  store_id: string;
  nombre: string;
  sku: string;
  precio: number;
  stock: number;
  stock_minimo: number;
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
