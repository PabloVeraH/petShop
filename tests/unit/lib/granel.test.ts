/**
 * Tests U-164 a U-166: src/lib/granel.ts — descomposición del stock granel
 * (§4.6, D20): stock = sacos cerrados + ROUND(gramos abiertos / peso, 3).
 * Misma fórmula que fraccion_gramos() de migrations/077; la BD es la fuente
 * de verdad (verificada con stock_canales_fase1b_verificacion.sql).
 */
import * as fc from "fast-check";
import { estadoSacos, formatoSacos, textoResiduoSacos, agruparSacosAbiertos, etiquetaSaco, gramosDesdeValor, errorLineaGranel, montoDevolucionGranel } from "@/lib/granel";

describe("estadoSacos", () => {
  it("U-164: 9,967 con 14 500 g abiertos de un saco de 15 000 g → 9 cerrados", () => {
    expect(estadoSacos({ stock: 9.967, peso_gramos: 15000, saco_abierto_gramos: 14500 }))
      .toEqual({ peso: 15000, gramosAbiertos: 14500, cerrados: 9, residuo: 0 });
  });

  it.each([
    // sin saco abierto: todo el stock son cerrados
    [{ stock: 10, peso_gramos: 15000, saco_abierto_gramos: null }, 10],
    // saco recién abierto: 9 cerrados + 1,000 abierto = 10
    [{ stock: 10, peso_gramos: 15000, saco_abierto_gramos: 15000 }, 9],
    // 200 g de 15 000 → fracción 0,013 (redondeo a 3 decimales igual que la BD)
    [{ stock: 8.013, peso_gramos: 15000, saco_abierto_gramos: 200 }, 8],
    // gramos devueltos sin saco (fracción > 1): 0 cerrados
    [{ stock: 1.5, peso_gramos: 10000, saco_abierto_gramos: 15000 }, 0],
    // sin peso (dato inválido): no se descuenta fracción
    [{ stock: 4, peso_gramos: null, saco_abierto_gramos: 300 }, 4],
  ])("U-165: %p → %i cerrados", (prod, cerrados) => {
    expect(estadoSacos(prod).cerrados).toBe(cerrados);
  });
});

describe("formatoSacos", () => {
  it("U-166: 'N sacos + X kg' (G11), singular y decimales es-CL", () => {
    expect(formatoSacos(9, 14500)).toBe("9 sacos + 14,5 kg");
    expect(formatoSacos(1, 0)).toBe("1 saco + 0 kg");
    expect(formatoSacos(0, 250)).toBe("0 sacos + 0,25 kg");
  });
});

// U-213 — REGRESIÓN (QA 2026-09-27, BUG 8): BRV-003 (stock 0.2, peso 7000 g,
// sin saco abierto) se mostraba "0 sacos + 0 kg": la fracción heredada de S9
// no es ni saco cerrado ni gramos abiertos. Ahora se informa como residuo.
describe("residuo de stock (U-213)", () => {
  it("U-213: stock 0.2 sin saco abierto → 0 cerrados, residuo 0.2 y aviso en el texto", () => {
    const s = estadoSacos({ stock: 0.2, peso_gramos: 7000, saco_abierto_gramos: null });
    expect(s).toEqual({ peso: 7000, gramosAbiertos: 0, cerrados: 0, residuo: 0.2 });
    expect(formatoSacos(s.cerrados, s.gramosAbiertos, s.residuo)).toBe("0 sacos + 0 kg (+0,2 saco sin asignar)");
  });

  it("U-213: stock consistente no tiene residuo y el texto no cambia", () => {
    const s = estadoSacos({ stock: 9.967, peso_gramos: 15000, saco_abierto_gramos: 14500 });
    expect(s.residuo).toBe(0);
    expect(formatoSacos(s.cerrados, s.gramosAbiertos, s.residuo)).toBe("9 sacos + 14,5 kg");
    expect(estadoSacos({ stock: 10, peso_gramos: 15000, saco_abierto_gramos: null }).residuo).toBe(0);
  });
});

// U-219 — textoResiduoSacos: el texto del residuo que el POS muestra aparte
// del badge (GR-U-24); formatoSacos (Inventario) conserva el texto combinado.
describe("textoResiduoSacos (U-219)", () => {
  it("U-219: residuo > 0 → '+0,2 saco sin asignar'; 0 → vacío; formatoSacos sin cambios", () => {
    expect(textoResiduoSacos(0.2)).toBe("+0,2 saco sin asignar");
    expect(textoResiduoSacos(0)).toBe("");
    expect(formatoSacos(0, 0, 0.2)).toBe("0 sacos + 0 kg (+0,2 saco sin asignar)");
    expect(formatoSacos(9, 14500)).toBe("9 sacos + 14,5 kg");
  });
});


// VSA-U-01…03 — varios sacos abiertos (migración 096).
describe("granel con varios sacos abiertos", () => {
  it("VSA-U-01: la fracción se redondea saco por saco (como fraccion_saco_abierto en la BD)", () => {
    // 2 × round(1/3, 3) = 0,666 (por saco) ≠ round(2/3, 3) = 0,667 (sobre la suma)
    const prod = {
      stock: 3.666, peso_gramos: 3000, saco_abierto_gramos: 2000,
      sacos_abiertos: [
        { id: "a", gramos_restantes: 1000, nota: null, abierto_at: "2026-11-23T10:00:00Z" },
        { id: "b", gramos_restantes: 1000, nota: null, abierto_at: "2026-11-23T11:00:00Z" },
      ],
    };
    expect(estadoSacos(prod)).toEqual({ peso: 3000, gramosAbiertos: 2000, cerrados: 3, residuo: 0 });
  });

  it("VSA-U-02: agruparSacosAbiertos suma por producto y ordena del más antiguo al más nuevo", () => {
    const m = agruparSacosAbiertos([
      { id: "b", producto_id: "p1", gramos_restantes: 500, nota: null, abierto_at: "2026-11-23T15:00:00Z" },
      { id: "x", producto_id: "p2", gramos_restantes: 100, nota: null, abierto_at: "2026-11-23T09:00:00Z" },
      { id: "a", producto_id: "p1", gramos_restantes: 1500, nota: "Mesón 1", abierto_at: "2026-11-23T12:00:00Z" },
    ]);
    expect(m.get("p1")).toEqual({
      gramos: 2000,
      sacos: [
        { id: "a", gramos_restantes: 1500, nota: "Mesón 1", abierto_at: "2026-11-23T12:00:00Z" },
        { id: "b", gramos_restantes: 500, nota: null, abierto_at: "2026-11-23T15:00:00Z" },
      ],
    });
    expect(m.get("p2")?.gramos).toBe(100);
    expect(m.has("p3")).toBe(false);
  });

  it("VSA-U-03: etiquetaSaco usa el nombre o, sin él, el orden de apertura", () => {
    const base = { id: "a", gramos_restantes: 12500, abierto_at: "" };
    expect(etiquetaSaco({ ...base, nota: "Mesón 2" }, 0)).toBe("Mesón 2 · 12,5 kg");
    expect(etiquetaSaco({ ...base, nota: "  " }, 1)).toBe("Saco 2 · 12,5 kg");
  });
});

// VGV-U-01…06 — venta a granel por valor (migración 099).
describe("granel por valor (099)", () => {
  it("VGV-U-01: gramos más cercanos al valor según el precio por kg", () => {
    expect(gramosDesdeValor(2000, 11000)).toBe(182); // 181,8
    expect(gramosDesdeValor(2000, 3490)).toBe(573);  // 573,07
    expect(gramosDesdeValor(5000, 5000)).toBe(1000);
    expect(gramosDesdeValor(5, 11000)).toBe(0);      // no alcanza para 1 g
    expect(gramosDesdeValor(1000, 0)).toBe(0);
  });

  it("VGV-U-02 (propiedad): lo cobrado difiere a lo más medio gramo del precio de lista", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 10_000_000 }), fc.integer({ min: 100, max: 100_000 }), (valor, precioKg) => {
      const g = gramosDesdeValor(valor, precioKg);
      expect(Math.abs((g * precioKg) / 1000 - valor)).toBeLessThanOrEqual(precioKg / 2000 + 1e-6);
    }));
  });

  it("VGV-U-03: tienda por gramos → acepta gramos y rechaza valor", () => {
    expect(errorLineaGranel({ gramos: 500 }, 5000, false)).toBeNull();
    expect(errorLineaGranel({ gramos: 400, monto: 2000 }, 5000, false)).toMatch(/por gramos/);
  });

  it("VGV-U-04: tienda por valor → exige monto, al menos 1 g y que los gramos calcen con el precio", () => {
    expect(errorLineaGranel({ gramos: 182, monto: 2000 }, 11000, true)).toBeNull();
    expect(errorLineaGranel({ gramos: 500 }, 5000, true)).toMatch(/por valor/);
    expect(errorLineaGranel({ gramos: 1, monto: 5 }, 11000, true)).toMatch(/no alcanza para 1 gramo/);
    expect(errorLineaGranel({ gramos: 5000, monto: 2000 }, 11000, true)).toMatch(/precio por kg cambió.*182 g/);
  });

  it("VGV-U-05: devolución = parte de lo cobrado, con descuento y por partes sin perder pesos", () => {
    const linea = { subtotal: 2000, cantidad: 0.182 };
    expect(montoDevolucionGranel(linea, 0, 0.182, 1)).toBe(2000); // kg × precio daría 2002
    expect(montoDevolucionGranel(linea, 0, 0.182, 0.9)).toBe(1800);
    expect(montoDevolucionGranel(linea, 0, 0.061, 1) + montoDevolucionGranel(linea, 0.061, 0.061, 1) + montoDevolucionGranel(linea, 0.122, 0.06, 1)).toBe(2000);
  });

  it("VGV-U-06 (propiedad): dos devoluciones parciales suman exactamente la completa", () => {
    fc.assert(fc.property(
      fc.integer({ min: 2, max: 50_000 }), fc.integer({ min: 1, max: 500_000 }), fc.integer({ min: 0, max: 100 }), fc.double({ min: 0, max: 1, noNaN: true }),
      (gramos, subtotal, desc, corte) => {
        const f = desc > 0 ? (100 - desc) / 100 : 1;
        const g1 = Math.min(gramos - 1, Math.max(1, Math.round(gramos * corte)));
        const linea = { subtotal, cantidad: gramos / 1000 };
        expect(montoDevolucionGranel(linea, 0, g1 / 1000, f) + montoDevolucionGranel(linea, g1 / 1000, (gramos - g1) / 1000, f))
          .toBe(montoDevolucionGranel(linea, 0, gramos / 1000, f));
      }
    ));
  });
});
