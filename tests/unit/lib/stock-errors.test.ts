/**
 * Tests U-159 a U-162: mapearErrorStock (src/lib/stock-errors.ts) — traducción
 * de los RAISE EXCEPTION de las funciones de stock (migraciones 074–076) a
 * HTTP. Los prefijos deben coincidir literalmente con los mensajes de las
 * migraciones; si un mensaje SQL cambia, este test y el mapa deben cambiar
 * juntos.
 */
import { mapearErrorStock } from "@/lib/stock-errors";

describe("mapearErrorStock", () => {
  it.each([
    ["Stock insuficiente: disponible 2, solicitado 5", 422],
    ["Stock insuficiente: disponible 3 unidades vigentes, requerido 4", 422],
    ["Falta la fecha de vencimiento del stock existente (100 unidades)", 422],
    ["Producto con lotes activos: el stock se descuenta desde los lotes (producto=x)", 409],
    ["Producto con lotes: el conteo físico se registra por lote", 409],
    ["El lote ya está dado de baja", 409],
    ["El lote no está vencido (vence 2027-01-01)", 409],
    ["Cantidad inválida para descontar stock: 0", 400],
    ["Cantidad actual inválida para el lote: 11", 400],
    ["Cantidad contada inválida: -1", 400],
    ["El motivo del conteo es obligatorio (mínimo 5 caracteres)", 400],
  ])("U-159: '%s' → %i con el mensaje de la BD", (msg, status) => {
    expect(mapearErrorStock(msg)).toEqual({ status, error: msg });
  });

  it("U-160: 404 no repite el UUID del mensaje (no confirma ni filtra identificadores)", () => {
    expect(mapearErrorStock("Producto no encontrado: 123e4567-e89b-12d3-a456-426614174010"))
      .toEqual({ status: 404, error: "Producto no encontrado" });
    expect(mapearErrorStock("Lote no encontrado: 123e4567-e89b-12d3-a456-426614174020"))
      .toEqual({ status: 404, error: "Lote no encontrado" });
  });

  it("U-161: mensaje no reconocido → 500 genérico (no filtra el error interno)", () => {
    expect(mapearErrorStock("relation \"x\" does not exist")).toEqual({ status: 500, error: "Error interno del servidor" });
  });

  it("U-162: null/undefined/vacío → 500 genérico", () => {
    expect(mapearErrorStock(null).status).toBe(500);
    expect(mapearErrorStock(undefined).status).toBe(500);
    expect(mapearErrorStock("").status).toBe(500);
  });
});

// Fase 1b — granel (migraciones 077/078): prefijos de las funciones de saco.
describe("mapearErrorStock — granel", () => {
  it.each([
    ["Saco abierto insuficiente: quedan 200 g, se requieren 500 g — confirme la apertura de un saco nuevo", 409],
    ["Saco abierto con gramos restantes (700 g): registre la merma del resto antes de abrir otro", 409],
    ["No hay saco abierto para este producto", 409],
    ["El saco no se puede deshacer: tiene ventas asociadas", 409],
    ["No se puede cambiar el peso del saco con un saco abierto: registre la merma o termine el saco primero", 409],
    ["Producto no habilitado para granel (requiere precio por kg y peso del saco)", 400],
    ["El motivo de la merma es obligatorio (mínimo 5 caracteres)", 400],
  ])("U-163: '%s' → %i con el mensaje de la BD", (msg, status) => {
    expect(mapearErrorStock(msg)).toEqual({ status, error: msg });
  });
});
