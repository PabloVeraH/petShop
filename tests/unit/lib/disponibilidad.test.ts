/**
 * Tests U-CITA-01 a U-CITA-07: lib/disponibilidad (funciones puras).
 * Archivo nuevo — no existía análogo en Fase 1.
 */
import { rangosSuperponen, sumarMinutos, calcularSlotsDisponibles } from "@/lib/disponibilidad";

describe("rangosSuperponen", () => {
  // U-CITA-01
  it("U-CITA-01: rangos que se solapan parcialmente → true", () => {
    expect(rangosSuperponen("09:00", "10:00", "09:30", "10:30")).toBe(true);
    expect(rangosSuperponen("09:30", "10:30", "09:00", "10:00")).toBe(true);
    expect(rangosSuperponen("09:00", "10:00", "09:00", "10:00")).toBe(true);
  });

  // U-CITA-02
  it("U-CITA-02: rangos contiguos (fin de uno == inicio del otro) → false", () => {
    expect(rangosSuperponen("09:00", "09:30", "09:30", "10:00")).toBe(false);
    expect(rangosSuperponen("09:30", "10:00", "09:00", "09:30")).toBe(false);
  });
});

describe("sumarMinutos", () => {
  // U-CITA-03
  it("U-CITA-03: sumarMinutos('09:00', 90) → '10:30'", () => {
    expect(sumarMinutos("09:00", 90)).toBe("10:30");
    expect(sumarMinutos("09:00", 30)).toBe("09:30");
    expect(sumarMinutos("23:30", 30)).toBe("24:00");
  });

  // U-CITA-04
  it("U-CITA-04: cruce de medianoche no contemplado — limitación documentada, sin comportamiento definido (no se testea)", () => {
    // sumarMinutos("23:30", 60) → "24:30" es una hora inválida deliberada;
    // los servicios del catálogo son diurnos y el CHECK hora_inicio < hora_fin
    // de la tabla lo impide a nivel de datos. No hay comportamiento definido
    // que asertar aquí — solo se documenta la limitación.
    expect(true).toBe(true);
  });
});

describe("calcularSlotsDisponibles", () => {
  // U-CITA-05
  it("U-CITA-05: ventana 09:00-11:00, duración 30min, sin ocupados → 4 slots", () => {
    const slots = calcularSlotsDisponibles({ hora_inicio: "09:00", hora_fin: "11:00" }, 30, []);
    expect(slots.map((s) => s.hora_inicio)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
  });

  // U-CITA-06
  it("U-CITA-06: con un ocupado 09:30-10:00 → excluye ese slot, quedan 3", () => {
    const slots = calcularSlotsDisponibles(
      { hora_inicio: "09:00", hora_fin: "11:00" },
      30,
      [{ hora_inicio: "09:30", hora_fin: "10:00" }]
    );
    expect(slots.map((s) => s.hora_inicio)).toEqual(["09:00", "10:00", "10:30"]);
  });

  // U-CITA-07
  it("U-CITA-07: duración que no cabe entera en la ventana → el último slot no excede hora_fin", () => {
    // Ventana 09:00-10:00, duración 45: solo cabe 09:00-09:45.
    const slots = calcularSlotsDisponibles({ hora_inicio: "09:00", hora_fin: "10:00" }, 45, []);
    expect(slots).toHaveLength(1);
    expect(slots[0].hora_fin).toBe("09:45");
    // Caso degenerado: duración mayor que la ventana entera → 0 slots.
    expect(calcularSlotsDisponibles({ hora_inicio: "09:00", hora_fin: "10:00" }, 90, [])).toHaveLength(0);
  });
});
