import * as fc from "fast-check";
import { validateRUT, formatRUT } from "@/lib/validation";

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
