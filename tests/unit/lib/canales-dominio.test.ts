/**
 * Tests U-167 a U-176: dominio de canales externos (Fase 2, §4.1, §4.3, §4.5
 * de docs/canales-stock/stock_canales_externos.md). Funciones puras, sin I/O.
 */
import fc from "fast-check";
import {
  esEstadoOrden,
  esTerminal,
  origenesValidos,
  puedeTransicionar,
} from "@/lib/canales/domain/estados";
import { ESTADOS_ORDEN, esCanalExterno } from "@/lib/canales/domain/types";
import { precioBase, precioCanal } from "@/lib/canales/domain/precio";
import { cupoCanalExterno, disponibleEnCanal } from "@/lib/canales/domain/disponibilidad";
import fs from "fs";
import path from "path";

describe("máquina de estados de canal_ordenes (§4.3)", () => {
  it("U-167: el camino feliz pending → processing → accepted → ready → picked_up → delivered es válido", () => {
    const camino = ["pending", "processing", "accepted", "ready", "picked_up", "delivered"] as const;
    for (let i = 0; i < camino.length - 1; i++) {
      expect(puedeTransicionar(camino[i], camino[i + 1])).toBe(true);
    }
  });

  it("U-168: transiciones inválidas se rechazan (no se salta la aceptación ni se revive un estado terminal)", () => {
    expect(puedeTransicionar("pending", "accepted")).toBe(false);   // sin reclamo 'processing'
    expect(puedeTransicionar("delivered", "cancelled")).toBe(false);
    expect(puedeTransicionar("rejected", "pending")).toBe(false);
    expect(puedeTransicionar("cancelled", "processing")).toBe(false);
    expect(puedeTransicionar("picked_up", "cancelled")).toBe(false);
  });

  it("U-169: origenesValidos arma el WHERE de cada transición; failed se reintenta", () => {
    expect(origenesValidos("cancelled").sort()).toEqual(["accepted", "pending", "ready"]);
    expect(origenesValidos("processing")).toEqual(["pending"]);
    expect(origenesValidos("pending").sort()).toEqual(["failed", "processing"]);
    expect(esTerminal("delivered")).toBe(true);
    expect(esTerminal("failed")).toBe(false);
  });

  it("U-170: los estados del dominio son exactamente los del CHECK de migrations/079 (sin 'reserved', D6)", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "migrations/079_canales_nucleo.sql"), "utf8");
    const bloque = sql.match(/canal_ordenes_estado_check CHECK \(estado IN \(([\s\S]*?)\)\)/)?.[1] ?? "";
    const enSql = [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(enSql).toEqual([...ESTADOS_ORDEN].sort());
    expect(esEstadoOrden("reserved")).toBe(false);
    expect(esCanalExterno("rappi")).toBe(true);
    expect(esCanalExterno("pos")).toBe(false);
  });
});

describe("precio por canal (D7, D13, D14)", () => {
  it("U-171: D13 — base = precio_oferta si está en oferta, si no precio", () => {
    expect(precioBase({ precio: 10000, precio_oferta: 8000, en_oferta: true })).toBe(8000);
    expect(precioBase({ precio: 10000, precio_oferta: 8000, en_oferta: false })).toBe(10000);
    expect(precioBase({ precio: 10000, precio_oferta: null, en_oferta: true })).toBe(10000);
    expect(precioBase({ precio: null })).toBeNull();
  });

  it("U-172: D7/D14 — recargo y redondeo hacia arriba a la decena, sin error de punto flotante", () => {
    expect(precioCanal(1000, 15)).toBe(1150);   // 1000 × 1,15 en float = 1150.0000000000002
    expect(precioCanal(1001, 15)).toBe(1160);   // 1151,15 → 1160
    expect(precioCanal(999, 12.5)).toBe(1130);  // 1123,875 → 1130
    expect(precioCanal(4990, 0)).toBe(4990);
    expect(precioCanal(4991, 0)).toBe(5000);
  });

  it("U-173: el override por producto manda sobre el recargo", () => {
    expect(precioCanal(1000, 15, 1299)).toBe(1299);
    expect(precioCanal(1000, 15, null)).toBe(1150);
    expect(() => precioCanal(0, 15)).toThrow();
    expect(() => precioCanal(1000, -1)).toThrow();
  });

  it("U-174: propiedad — el precio es múltiplo de 10, ≥ base × (1 + r) y < ese valor + 10", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5_000_000 }), fc.integer({ min: 0, max: 10_000 }), (base, rCent) => {
        const r = rCent / 100;
        const p = precioCanal(base, r);
        const exacto = (base * (10_000 + rCent)) / 10_000;
        return p % 10 === 0 && p >= exacto - 1e-6 && p < exacto + 10;
      })
    );
  });
});

describe("cupo y disponibilidad (D4, D18)", () => {
  it("U-175: cupo = unidades cerradas − stock_minimo, nunca negativo; stock_minimo null = 0 (V5)", () => {
    expect(cupoCanalExterno(10, 3)).toBe(7);
    expect(cupoCanalExterno(3, 3)).toBe(0);
    expect(cupoCanalExterno(2, 5)).toBe(0);
    expect(cupoCanalExterno(4, null)).toBe(4);
    expect(cupoCanalExterno(9.5, 0)).toBe(9);   // decimales heredados (S9) se truncan
  });

  it("U-176: disponible solo si producto activo, habilitado en el canal, canal activo y cupo > 0", () => {
    const base = { productoActivo: true, habilitadoEnCanal: true, canalActivo: true, cupo: 1 };
    expect(disponibleEnCanal(base)).toBe(true);
    expect(disponibleEnCanal({ ...base, cupo: 0 })).toBe(false);
    expect(disponibleEnCanal({ ...base, productoActivo: false })).toBe(false);
    expect(disponibleEnCanal({ ...base, habilitadoEnCanal: false })).toBe(false);
    expect(disponibleEnCanal({ ...base, canalActivo: false })).toBe(false);
  });
});
