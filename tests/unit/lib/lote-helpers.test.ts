/**
 * Tests para src/lib/lote-helpers.ts
 */

import { getLoteStatus, enriquecerLotes, clasificarLotes, productoTieneLotes } from "@/lib/lote-helpers";
import type { LoteProducto } from "@/types";

describe("getLoteStatus", () => {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const hoyStr = hoy.toISOString().split("T")[0];

  it("retorna 'vencido' si fecha < hoy", () => {
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);
    const result = getLoteStatus(ayer.toISOString().split("T")[0], 30);
    expect(result.status).toBe("vencido");
    expect(result.diasRestantes).toBe(-1);
    expect(result.label).toBe("Vencido");
  });

  it("retorna 'proximo' si 0 <= dias <= diasAlerta", () => {
    const result = getLoteStatus(hoyStr, 30);
    expect(result.status).toBe("proximo");
    expect(result.diasRestantes).toBe(0);
  });

  it("retorna 'vigente' si dias > diasAlerta", () => {
    const en30dias = new Date(hoy);
    en30dias.setDate(en30dias.getDate() + 31);
    const result = getLoteStatus(en30dias.toISOString().split("T")[0], 30);
    expect(result.status).toBe("vigente");
    expect(result.diasRestantes).toBe(31);
  });

  it("retorna 'proximo' con diasRestantes=0 si vence hoy", () => {
    const result = getLoteStatus(hoyStr, 30);
    expect(result.status).toBe("proximo");
    expect(result.diasRestantes).toBe(0);
    expect(result.label).toBe("Vence en 0d");
  });

  it("respeta diasAlerta personalizado", () => {
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);
    const result1 = getLoteStatus(manana.toISOString().split("T")[0], 30);
    expect(result1.status).toBe("proximo");

    const result2 = getLoteStatus(manana.toISOString().split("T")[0], 0);
    expect(result2.status).toBe("vigente"); // diasAlerta=0: diff=1 > 0, no está dentro del umbral

    const en5dias = new Date(hoy);
    en5dias.setDate(en5dias.getDate() + 5);
    const result3 = getLoteStatus(en5dias.toISOString().split("T")[0], 0);
    expect(result3.status).toBe("vigente");
  });

  it("maneja fechas muy lejanas", () => {
    const futuro = new Date(hoy);
    futuro.setFullYear(futuro.getFullYear() + 2);
    const result = getLoteStatus(futuro.toISOString().split("T")[0], 30);
    expect(result.status).toBe("vigente");
    expect(result.diasRestantes).toBeGreaterThan(365);
  });
});

describe("enriquecerLotes", () => {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const hoyStr = hoy.toISOString().split("T")[0];

  it("agrega status, dias_restantes y label a cada lote", () => {
    const en30dias = new Date(hoy);
    en30dias.setDate(en30dias.getDate() + 30);
    const lotes: LoteProducto[] = [
      {
        id: "1", store_id: "s1", producto_id: "p1",
        cantidad_inicial: 10, cantidad_actual: 10,
        fecha_vencimiento: en30dias.toISOString().split("T")[0],
        fecha_ingreso: hoyStr, activo: true,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    ];
    const enriched = enriquecerLotes(lotes, 30);
    expect(enriched[0]).toHaveProperty("status");
    expect(enriched[0]).toHaveProperty("diasRestantes");
    expect(enriched[0]).toHaveProperty("label");
    expect(enriched[0].label).toContain("Vence");
  });

  it("no muta el array original", () => {
    const en30dias = new Date(hoy);
    en30dias.setDate(en30dias.getDate() + 30);
    const original: LoteProducto[] = [
      {
        id: "1", store_id: "s1", producto_id: "p1",
        cantidad_inicial: 10, cantidad_actual: 10,
        fecha_vencimiento: en30dias.toISOString().split("T")[0],
        fecha_ingreso: hoyStr, activo: true,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    ];
    const originalStr = JSON.stringify(original);
    enriquecerLotes(original, 30);
    expect(JSON.stringify(original)).toBe(originalStr);
  });
});

describe("clasificarLotes", () => {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const hoyStr = hoy.toISOString().split("T")[0];

  function makeLote(diasVence: number, id: string): LoteProducto {
    const fecha = new Date(hoy);
    fecha.setDate(fecha.getDate() + diasVence);
    return {
      id, store_id: "s1", producto_id: "p1",
      cantidad_inicial: 10, cantidad_actual: 10,
      fecha_vencimiento: fecha.toISOString().split("T")[0],
      fecha_ingreso: hoyStr, activo: true,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
  }

  it("agrupa correctamente en vencidos/proximos/vigentes", () => {
    const lotes = [
      makeLote(-5, "v1"),
      makeLote(-1, "v2"),
      makeLote(0, "p1"),
      makeLote(15, "p2"),
      makeLote(60, "v1b"),
    ];
    const result = clasificarLotes(lotes, 30);
    expect(result.vencidos).toHaveLength(2);
    expect(result.proximos).toHaveLength(2);
    expect(result.vigentes).toHaveLength(1);
  });

  it("maneja array vacío", () => {
    const result = clasificarLotes([], 30);
    expect(result.vencidos).toHaveLength(0);
    expect(result.proximos).toHaveLength(0);
    expect(result.vigentes).toHaveLength(0);
  });

  it("no muta el array original", () => {
    const lotes = [makeLote(10, "l1")];
    const originalStr = JSON.stringify(lotes);
    clasificarLotes(lotes, 30);
    expect(JSON.stringify(lotes)).toBe(originalStr);
  });
});

describe("productoTieneLotes", () => {
  it("retorna true si hay al menos un lote activo", () => {
    const lotes: LoteProducto[] = [
      {
        id: "1", store_id: "s1", producto_id: "p1",
        cantidad_inicial: 10, cantidad_actual: 10,
        fecha_vencimiento: "2027-01-01", fecha_ingreso: "2026-01-01",
        activo: true,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    ];
    expect(productoTieneLotes(lotes)).toBe(true);
  });

  it("retorna false si todos están inactivos", () => {
    const lotes: LoteProducto[] = [
      {
        id: "1", store_id: "s1", producto_id: "p1",
        cantidad_inicial: 10, cantidad_actual: 0,
        fecha_vencimiento: "2027-01-01", fecha_ingreso: "2026-01-01",
        activo: false,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    ];
    expect(productoTieneLotes(lotes)).toBe(false);
  });

  it("retorna false para array vacío", () => {
    expect(productoTieneLotes([])).toBe(false);
  });
});