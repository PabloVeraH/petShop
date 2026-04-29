import { _setResendInstance } from "@/lib/email";
import { buildFoodReminderHTML } from "@/lib/email";

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