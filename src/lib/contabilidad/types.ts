export type TipoCuenta = 'ACTIVO' | 'PASIVO' | 'PATRIMONIO' | 'INGRESO' | 'GASTO';
export type TipoMovimiento = 'VENTA' | 'NOTA_CREDITO' | 'COMPRA' | 'PAGO_PROVEEDOR' | 'AJUSTE' | 'CIERRE_MES' | 'ANULACION_VENTA';

export interface ChartOfAccount {
  id: string;
  storeId: string;
  codigo: string;
  nombre: string;
  descripcion?: string;
  tipo: TipoCuenta;
  subtipo?: string;
  activo: boolean;
  requiereConciliacion: boolean;
  saldoInicial: number;
  saldoActual: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface JournalEntry {
  id: string;
  storeId: string;
  numeroAsiento: number;
  fecha: string;
  tipoMovimiento?: TipoMovimiento;
  referenciaId?: string;
  referenciaNomero?: string;
  descripcion: string;
  totalDebito: number;
  totalCredito: number;
  estaBalanceado: boolean;
  usuarioId?: string;
  creadoPor?: string;
  lineas: JournalDetail[];
  createdAt: string;
  updatedAt: string;
}

export interface JournalDetail {
  id: string;
  journalEntryId: string;
  numeroLinea: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  cuentaTipo?: string;
  debito: number;
  credito: number;
  descripcionLinea?: string;
  createdAt: string;
}

export interface LineaAsiento {
  cuentaCodigo: string;
  cuentaNombre: string;
  cuentaTipo?: string;
  debito: number;
  credito: number;
  descripcionLinea?: string;
}

export interface CrearAsientoInput {
  storeId: string;
  fecha: string;
  tipoMovimiento?: TipoMovimiento;
  canal?: "pos" | "rappi" | "pedidosya" | "ubereats";
  referenciaId?: string;
  referenciaNomero?: string;
  descripcion: string;
  lineas: LineaAsiento[];
  usuarioId?: string;
  creadoPor?: string;
}

// Cuentas contables del plan (Chile SII)
export const CUENTAS = {
  CAJA: { codigo: '110101', nombre: 'Caja Operacional', tipo: 'ACTIVO' as TipoCuenta },
  BANCO: { codigo: '110201', nombre: 'Banco Operacional', tipo: 'ACTIVO' as TipoCuenta },
  SALDOS_FAVOR: { codigo: '110502', nombre: 'Saldos a Favor Clientes', tipo: 'ACTIVO' as TipoCuenta },
  // IVA crédito fiscal (activo): se recupera en compras (Dr al comprar)
  IVA_CREDITO_FISCAL: { codigo: '110601', nombre: 'IVA Crédito Fiscal', tipo: 'ACTIVO' as TipoCuenta },
  INVENTARIO: { codigo: '111001', nombre: 'Inventario de Productos', tipo: 'ACTIVO' as TipoCuenta },
  PROVEEDORES: { codigo: '210101', nombre: 'Proveedores', tipo: 'PASIVO' as TipoCuenta },
  // IVA débito fiscal (pasivo): se debe al SII por ventas (Cr al vender)
  IVA_PAGAR: { codigo: '210501', nombre: 'IVA por Pagar', tipo: 'PASIVO' as TipoCuenta },
  VENTAS: { codigo: '410101', nombre: 'Venta de Productos', tipo: 'INGRESO' as TipoCuenta },
  DEVOLUCIONES: { codigo: '410102', nombre: 'Devoluciones en Ventas', tipo: 'INGRESO' as TipoCuenta },
  COGS: { codigo: '510101', nombre: 'Costo de Bienes Vendidos', tipo: 'GASTO' as TipoCuenta },
  // Cuentas por cobrar por canal
  CXC_RAPPI: { codigo: '110401', nombre: 'CxC Rappi', tipo: 'ACTIVO' as TipoCuenta },
  CXC_PEDIDOSYA: { codigo: '110402', nombre: 'CxC PedidosYa', tipo: 'ACTIVO' as TipoCuenta },
  CXC_UBEREATS: { codigo: '110403', nombre: 'CxC UberEats', tipo: 'ACTIVO' as TipoCuenta },
  // Devoluciones por canal externo
  DEVOLUCIONES_CANAL: { codigo: '510201', nombre: 'Devoluciones Canal Externo', tipo: 'GASTO' as TipoCuenta },
} as const;
