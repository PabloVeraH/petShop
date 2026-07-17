import { _setResendInstance } from "@/lib/email";
import { buildFoodReminderHTML, buildBoletaEmailHTML } from "@/lib/email";
import type { BoletaData } from "@/lib/reports/pdf-generator";

jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn() },
  })),
}));

_setResendInstance(new (require("resend").Resend)("re_test"));

describe("lib/email", () => {
  const baseParams = {
    to: "cliente@test.com",
    clienteNombre: "Juan Pérez",
    storeName: "PetShop Test",
    items: [
      {
        mascotaNombre: "Rex",
        productoNombre: "Royal Canin Adult",
        diasRestantes: 5,
        precioUnitario: 15000,
      },
    ],
  };

  it("U-101: buildFoodReminderHTML genera HTML con nombre del cliente", () => {
    const html = buildFoodReminderHTML(baseParams);
    expect(html).toContain("Juan Pérez");
  });

  it("U-102: buildFoodReminderHTML contiene subject con nombre de mascota", () => {
    const params = { ...baseParams };
    const html = buildFoodReminderHTML(params);
    expect(html).toContain("Rex");
  });

  it("U-103: buildFoodReminderHTML muestra 'Se acabó hoy' cuando diasRestantes <= 0", () => {
    const params = {
      ...baseParams,
      items: [{ ...baseParams.items[0], diasRestantes: 0 }],
    };
    const html = buildFoodReminderHTML(params);
    expect(html).toContain("Se acabó hoy");
  });

  it("U-104: buildFoodReminderHTML pluraliza correctamente 'días' con diasRestantes = 1", () => {
    const params = {
      ...baseParams,
      items: [{ ...baseParams.items[0], diasRestantes: 1 }],
    };
    const html = buildFoodReminderHTML(params);
    expect(html).toContain("Queda 1 día");
  });

  it("U-105: buildFoodReminderHTML usa 'Quedan' para múltiples días", () => {
    const params = {
      ...baseParams,
      items: [{ ...baseParams.items[0], diasRestantes: 3 }],
    };
    const html = buildFoodReminderHTML(params);
    expect(html).toContain("Quedan 3 días");
  });

  it("U-106: buildFoodReminderHTML formatea precio en CLP", () => {
    const params = {
      ...baseParams,
      items: [{ ...baseParams.items[0], precioUnitario: 25000 }],
    };
    const html = buildFoodReminderHTML(params);
    expect(html).toContain("$25.000");
  });

  it("U-107: buildFoodReminderHTML maneja múltiples mascotas", () => {
    const params = {
      ...baseParams,
      items: [
        { mascotaNombre: "Rex", productoNombre: "Royal Canin", diasRestantes: 5, precioUnitario: 15000 },
        { mascotaNombre: "Luna", productoNombre: "Whiskas", diasRestantes: 3, precioUnitario: 8000 },
      ],
    };
    const html = buildFoodReminderHTML(params);
    expect(html).toContain("Rex");
    expect(html).toContain("Luna");
    expect(html).toContain("Royal Canin");
    expect(html).toContain("Whiskas");
  });

  it("U-108: buildFoodReminderHTML usa texto 'tu mascota' cuando falta nombre", () => {
    const params = {
      ...baseParams,
      items: [{ ...baseParams.items[0], mascotaNombre: "" }],
    };
    const html = buildFoodReminderHTML(params);
    expect(html).toContain("tu mascota");
  });
});

describe("buildBoletaEmailHTML — Subtotal (U-122/U-123)", () => {
  function baseBoleta(overrides: Partial<BoletaData> = {}): BoletaData {
    return {
      numeroComprobante: "20260717-TEST",
      fecha: "2026-07-17T12:00:00.000Z",
      storeName: "PetShop Test",
      items: [{ nombre: "Alimento Pro Plan 3kg", cantidad: 1, precio_unitario: 11900, subtotal: 11900 }],
      subtotal: 11900,
      descuentoPct: 0,
      descuentoMonto: 0,
      impuesto: 1900,
      total: 11900,
      pagos: [{ metodo: "efectivo", monto: 11900 }],
      ...overrides,
    };
  }

  // U-122: caso sin descuento. NOTA: esta variante NO distingue el código antes/después
  // del fix — netoDesdeBruto(subtotal_bruto_pre_descuento) y (total − impuesto) coinciden
  // matemáticamente cuando descuento=0, porque ahí subtotal_bruto === total. Se mantiene
  // como cobertura de no-regresión del caso más común (venta sin descuento), no como
  // prueba diferenciadora; U-123 es la que sí falla contra el código defectuoso.
  it("U-122: sin descuento, Subtotal muestra el neto (total − impuesto), consistente con Subtotal + IVA = Total", () => {
    const html = buildBoletaEmailHTML(baseBoleta());

    // Subtotal correcto: 11900 − 1900 = 10000, NO 11900 (bruto == Total)
    expect(html).toContain("Subtotal: $10.000");
    expect(html).not.toContain("Subtotal: $11.900");
    expect(html).toContain("TOTAL: $11.900");
  });

  // U-123: REGRESIÓN — con descuento, netoDesdeBruto(subtotal_bruto_pre_descuento) daba
  // $16.807 (verificado contra el código previo al fix, ver cierre de la tarea);
  // Subtotal + IVA = Total exige $15.126 (neto del TOTAL post-descuento). Antes del fix,
  // buildBoletaEmailHTML tampoco estaba exportada — este test también cubre esa exposición.
  it("U-123: con descuento, Subtotal + IVA sigue sumando exactamente Total", () => {
    const html = buildBoletaEmailHTML(
      baseBoleta({
        subtotal: 20000,
        descuentoPct: 10,
        descuentoMonto: 2000,
        impuesto: 2874,
        total: 18000,
      })
    );

    expect(html).toContain("Subtotal: $15.126");
    expect(html).toContain("IVA (19%): $2.874");
    expect(html).toContain("TOTAL: $18.000");
    expect(15126 + 2874).toBe(18000);
  });
});