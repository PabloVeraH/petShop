import * as fc from "fast-check";
import { validateRUT, formatRUT, ServicioHorarioItemSchema } from "@/lib/validation";

// Arbitrary that generates valid RUT bodies (7-8 digits)
const validRutBody = fc.integer({ min: 1000000, max: 99999999 }).map(String);

function computeDV(body: string): string {
  const digits = body.split("").reverse();
  let sum = 0;
  let mult = 2;
  for (const d of digits) {
    sum += parseInt(d) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const r = 11 - (sum % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
}

describe("PROP-01: validateRUT — invariantes de propiedad", () => {
  it("siempre retorna boolean (nunca lanza excepción)", () => {
    fc.assert(
      fc.property(fc.string(), (rut) => {
        const result = validateRUT(rut);
        expect(typeof result).toBe("boolean");
      })
    );
  });

  it("acepta cualquier RUT con cuerpo válido y dígito correcto", () => {
    fc.assert(
      fc.property(validRutBody, (body) => {
        const dv = computeDV(body);
        expect(validateRUT(`${body}-${dv}`)).toBe(true);
      })
    );
  });

  it("rechaza RUT con dígito verificador incorrecto", () => {
    fc.assert(
      fc.property(validRutBody, (body) => {
        const correctDV = computeDV(body);
        const wrongDV = correctDV === "0" ? "1" : "0";
        expect(validateRUT(`${body}-${wrongDV}`)).toBe(false);
      })
    );
  });
});

describe("PROP-02: formatRUT — invariantes de propiedad", () => {
  it("siempre produce string con exactamente un guión", () => {
    fc.assert(
      fc.property(validRutBody, (body) => {
        const dv = computeDV(body);
        const formatted = formatRUT(`${body}-${dv}`);
        expect((formatted.match(/-/g) ?? []).length).toBe(1);
      })
    );
  });

  it("formatRUT es idempotente (formatear dos veces = formatear una vez)", () => {
    fc.assert(
      fc.property(validRutBody, (body) => {
        const dv = computeDV(body);
        const rut = `${body}-${dv}`;
        const once = formatRUT(rut);
        const twice = formatRUT(once);
        expect(once).toBe(twice);
      })
    );
  });
});

describe("PROP-03: redondeo CLP — invariantes de propiedad", () => {
  it("Math.round de precio × cantidad siempre es entero", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1000000, noNaN: true }),
        fc.integer({ min: 1, max: 100 }),
        (precio, cantidad) => {
          const result = Math.round(precio * cantidad);
          expect(Number.isInteger(result)).toBe(true);
        }
      )
    );
  });

  it("IVA 19% incluido es siempre mayor o igual al neto", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000000 }), (neto) => {
        const conIva = Math.round(neto * 1.19);
        expect(conIva).toBeGreaterThanOrEqual(neto);
      })
    );
  });
});

describe("PROP-04: servicio_horarios — invariante hora_inicio < hora_fin", () => {
  it("hora_inicio < hora_fin siempre aceptado; hora_inicio >= hora_fin siempre rechazado", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }),
        (h1, m1, h2, m2) => {
          const pad = (n: number) => String(n).padStart(2, "0");
          const inicio = `${pad(h1)}:${pad(m1)}`;
          const fin = `${pad(h2)}:${pad(m2)}`;
          const result = ServicioHorarioItemSchema.safeParse({ dia_semana: 1, hora_inicio: inicio, hora_fin: fin });
          expect(result.success).toBe(inicio < fin);
        }
      )
    );
  });
});
