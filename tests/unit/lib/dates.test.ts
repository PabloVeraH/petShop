/**
 * Unit tests U-150 / U-151: src/lib/dates.ts — parseo/format de fechas
 * "date-only" (columnas DATE de Postgres, "YYYY-MM-DD").
 *
 * Regresión ticket Trello 6a77ef3a0ed45ac54505c62a: new Date("2026-05-01")
 * interpreta la cadena como medianoche UTC y, formateada en América/Santiago
 * (UTC-3/-4), desplaza la fecha 1 día antes (30-04-2026). El sufijo
 * "T00:00:00" preserva el componente de fecha sin importar el huso del proceso.
 */
import {
  formatDateOnlyEsCL, parseDateOnlyLocal, hoyNegocioISO, hoyNegocioCompacto, anioMesNegocio,
  sumarDiasISO, diasEntreISO, fechaNegocioDeTimestamp, fechaNegocioISO, inicioDiaNegocio,
  rangoDiaNegocio, inicioMesNegocio, diaSemanaNegocio,
} from "@/lib/dates";

describe("parseDateOnlyLocal", () => {
  // U-150
  it("U-150: parsea 'YYYY-MM-DD' como medianoche LOCAL preservando el día (31-12-2026 no se desplaza a 30-12)", () => {
    const d = parseDateOnlyLocal("2026-12-31");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11); // diciembre (0-indexado)
    expect(d.getDate()).toBe(31);
    expect(d.getHours()).toBe(0);
  });
});

describe("formatDateOnlyEsCL", () => {
  // U-151: con los valores reales del repro ("2026-05-01"/"2026-12-31") el
  // texto es igual a la fecha almacenada, sin el 1 día de desfase.
  it("U-151: formatea la fecha almacenada sin desfase (2026-05-01 → 01-05-2026)", () => {
    expect(formatDateOnlyEsCL("2026-05-01")).toBe("01-05-2026");
    expect(formatDateOnlyEsCL("2026-12-31")).toBe("31-12-2026");
    expect(formatDateOnlyEsCL("2026-05-01")).not.toBe("30-04-2026");
    expect(formatDateOnlyEsCL("2026-12-31")).not.toBe("30-12-2026");
  });
});

// Fechas del negocio (hora de Chile). Vercel corre en UTC: entre ~21:00 y
// 24:00 de Chile la fecha UTC ya es "mañana". Todos estos tests usan
// instantes explícitos, así que valen igual con TZ=UTC (Vercel) o con el TZ
// de Chile de un equipo local.
describe("fechas del negocio (America/Santiago)", () => {
  // 22-10-2026 22:30 en Chile (UTC-3) = 23-10-2026 01:30 UTC.
  const NOCHE_CHILE = new Date("2026-10-23T01:30:00Z");

  it("U-223: 'hoy' es la fecha de Chile aunque en UTC ya sea el día siguiente", () => {
    expect(NOCHE_CHILE.toISOString().slice(0, 10)).toBe("2026-10-23"); // lo que hacía el código
    expect(hoyNegocioISO(NOCHE_CHILE)).toBe("2026-10-22");
    expect(hoyNegocioCompacto(NOCHE_CHILE)).toBe("20261022");
    expect(hoyNegocioISO(new Date("2026-10-23T03:00:00Z"))).toBe("2026-10-23"); // medianoche Chile
  });

  it("U-224: año/mes y día de la semana del negocio cambian a medianoche de Chile, no de UTC", () => {
    // 31-12-2026 22:00 Chile = 01-01-2027 01:00 UTC
    const finDeAnio = new Date("2027-01-01T01:00:00Z");
    expect(anioMesNegocio(finDeAnio)).toEqual({ anio: 2026, mes: 12 });
    expect(diaSemanaNegocio(NOCHE_CHILE)).toBe(4); // jueves 22-10-2026 (en UTC ya es viernes)
  });

  it("U-225: sumarDiasISO y diasEntreISO son aritmética de calendario exacta (fin de mes, año y horario de verano)", () => {
    expect(sumarDiasISO("2026-10-22", 30)).toBe("2026-11-21");
    expect(sumarDiasISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDiasISO("2026-03-01", -1)).toBe("2026-02-28");
    expect(sumarDiasISO("2026-09-05", 1)).toBe("2026-09-06"); // cambio a horario de verano
    expect(diasEntreISO("2026-10-22", "2027-01-31")).toBe(101);
    expect(diasEntreISO("2026-09-01", "2026-09-30")).toBe(29);
    expect(diasEntreISO("2026-10-22", "2026-10-21")).toBe(-1);
  });

  it("U-226: fechaNegocioDeTimestamp interpreta los timestamp sin zona de la BD como UTC", () => {
    // Venta a las 22:30 de Chile: la BD guarda 2026-10-23T01:30:00 (UTC, sin zona).
    expect(fechaNegocioDeTimestamp("2026-10-23T01:30:00.123456")).toBe("2026-10-22");
    expect(fechaNegocioDeTimestamp("2026-10-23T01:30:00")).toBe("2026-10-22");
    expect(fechaNegocioDeTimestamp("2026-10-23T01:30:00Z")).toBe("2026-10-22");
    expect(fechaNegocioDeTimestamp("2026-10-23T01:30:00+00:00")).toBe("2026-10-22");
    expect(fechaNegocioDeTimestamp("2026-10-23T15:00:00")).toBe("2026-10-23");
  });

  it("U-227: inicioDiaNegocio es medianoche de Chile en UTC (verano −3, invierno −4) y la 01:00 el día del cambio de hora", () => {
    expect(inicioDiaNegocio("2026-10-22").toISOString()).toBe("2026-10-22T03:00:00.000Z");
    expect(inicioDiaNegocio("2026-07-15").toISOString()).toBe("2026-07-15T04:00:00.000Z");
    // 06-09-2026: el reloj salta de 24:00 a 01:00 → el día empieza 01:00 −03.
    expect(inicioDiaNegocio("2026-09-06").toISOString()).toBe("2026-09-06T04:00:00.000Z");
    // 05-04-2026: el reloj vuelve de 24:00 a 23:00 → el día empieza 00:00 −04.
    expect(inicioDiaNegocio("2026-04-05").toISOString()).toBe("2026-04-05T04:00:00.000Z");
  });

  it("U-228: invariante — para cada día de 2026 el inicio cae en ese día y el instante anterior en el día previo", () => {
    for (let f = "2026-01-01"; f <= "2026-12-31"; f = sumarDiasISO(f, 1)) {
      const inicio = inicioDiaNegocio(f).getTime();
      expect(fechaNegocioISO(new Date(inicio))).toBe(f);
      expect(fechaNegocioISO(new Date(inicio - 1))).toBe(sumarDiasISO(f, -1));
    }
  });

  it("U-229: rangoDiaNegocio e inicioMesNegocio devuelven límites UTC para filtrar timestamps", () => {
    expect(rangoDiaNegocio("2026-10-22")).toEqual({
      desde: "2026-10-22T03:00:00.000Z",
      hasta: "2026-10-23T03:00:00.000Z",
    });
    // 31-10-2026 22:00 Chile = 01-11 01:00 UTC → el mes en curso sigue siendo octubre.
    expect(inicioMesNegocio(new Date("2026-11-01T01:00:00Z"))).toBe("2026-10-01T03:00:00.000Z");
  });
});