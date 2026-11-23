/**
 * Tests U-164 a U-166: src/lib/granel.ts — descomposición del stock granel
 * (§4.6, D20): stock = sacos cerrados + ROUND(gramos abiertos / peso, 3).
 * Misma fórmula que fraccion_gramos() de migrations/077; la BD es la fuente
 * de verdad (verificada con stock_canales_fase1b_verificacion.sql).
 */
import { estadoSacos, formatoSacos, textoResiduoSacos, agruparSacosAbiertos, etiquetaSaco } from "@/lib/granel";

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
