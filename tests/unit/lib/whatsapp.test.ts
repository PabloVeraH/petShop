import {
  normalizeChileanPhone,
  buildReceiptMessage,
  buildConsumoAlertMessage,
} from "@/lib/whatsapp";

describe("lib/whatsapp", () => {
  // U-10
  it("U-10: normalizeChileanPhone con espacios y sin prefijo", () => {
    expect(normalizeChileanPhone("9 1234 5678")).toBe("56912345678");
  });

  // U-11
  it("U-11: normalizeChileanPhone con +56 ya incluido", () => {
    expect(normalizeChileanPhone("+56912345678")).toBe("56912345678");
  });

  // U-12
  it("U-12: normalizeChileanPhone rechaza número inválido → null", () => {
    expect(normalizeChileanPhone("12345")).toBeNull();
  });

  it("normalizeChileanPhone acepta formato 56912345678 directo", () => {
    expect(normalizeChileanPhone("56912345678")).toBe("56912345678");
  });

  // U-13
  it("U-13: buildReceiptMessage contiene número de comprobante", () => {
    const msg = buildReceiptMessage({
      storeName: "PetShop Test",
      numeroComprobante: "20260101-ABC123",
      clienteNombre: "Juan",
      items: [{ nombre: "Royal Canin", cantidad: 1, subtotal: 10000 }],
      total: 11900,
      metodoPago: "efectivo",
    });
    expect(msg).toContain("20260101-ABC123");
  });

  // U-14
  it("U-14: buildConsumoAlertMessage contiene nombre del producto", () => {
    const msg = buildConsumoAlertMessage({
      clienteNombre: "Juan",
      mascotaNombre: "Firulais",
      productoNombre: "Royal Canin Adult",
      diasRestantes: 5,
    });
    expect(msg).toContain("Royal Canin Adult");
  });

  it("buildReceiptMessage contiene nombre del cliente", () => {
    const msg = buildReceiptMessage({
      storeName: "PetShop Test",
      numeroComprobante: "20260101-ABC123",
      clienteNombre: "María González",
      items: [],
      total: 0,
      metodoPago: "debito",
    });
    expect(msg).toContain("María González");
  });
});
