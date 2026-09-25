// Traduce los errores de las funciones SQL de stock (migraciones 074–076) a
// una respuesta HTTP. Las funciones lanzan RAISE EXCEPTION con prefijos
// estables; este es el único lugar que los interpreta para que todos los
// endpoints de stock respondan igual. Mensajes no reconocidos → 500 genérico
// (no se filtra al cliente un error interno de la BD).

export interface StockErrorHttp {
  status: number;
  error: string;
}

const REGLAS: { prefijo: string; status: number }[] = [
  { prefijo: "Stock insuficiente", status: 422 },
  { prefijo: "Falta la fecha de vencimiento", status: 422 },
  { prefijo: "Producto no encontrado", status: 404 },
  { prefijo: "Lote no encontrado", status: 404 },
  { prefijo: "Producto con lotes", status: 409 },
  { prefijo: "El lote ya está dado de baja", status: 409 },
  { prefijo: "El lote no está vencido", status: 409 },
  { prefijo: "Cantidad inválida", status: 400 },
  { prefijo: "Cantidad actual inválida", status: 400 },
  { prefijo: "Cantidad contada inválida", status: 400 },
  { prefijo: "El motivo del conteo", status: 400 },
  // Granel (migraciones 077/078)
  { prefijo: "Saco abierto insuficiente", status: 409 },
  { prefijo: "Saco abierto con gramos restantes", status: 409 },
  { prefijo: "No hay saco abierto", status: 409 },
  { prefijo: "El saco no se puede deshacer", status: 409 },
  { prefijo: "No se puede cambiar el peso del saco", status: 409 },
  { prefijo: "Producto no habilitado para granel", status: 400 },
  { prefijo: "El motivo de la merma", status: 400 },
];

export function mapearErrorStock(message: string | null | undefined): StockErrorHttp {
  const msg = message ?? "";
  for (const { prefijo, status } of REGLAS) {
    if (msg.startsWith(prefijo)) {
      // Los 404 no repiten el UUID que traiga el mensaje de la BD.
      if (status === 404) return { status, error: prefijo };
      return { status, error: msg };
    }
  }
  return { status: 500, error: "Error interno del servidor" };
}
