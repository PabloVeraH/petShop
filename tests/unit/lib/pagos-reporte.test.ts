/**
 * Tests U-270 a U-275: src/lib/reports/pagos-reporte.ts — reparto de ventas
 * mixtas por método y monto a boletear para reportes/dashboard (pago mixto F10).
 */
import {
  cargarPagosPorVenta,
  metodosParaAgrupar,
  resumenBoleta,
  ventasConPagos,
} from "@/lib/reports/pagos-reporte";

const STORE = "store-a";

function supabaseCon(rows: unknown[]) {
  const c: Record<string, jest.Mock> = { select: jest.fn(), eq: jest.fn(), in: jest.fn() };
  c.select.mockReturnValue(c);
  c.eq.mockReturnValue(c);
  c.in.mockResolvedValue({ data: rows, error: null });
  const from = jest.fn().mockReturnValue(c);
  return { supabase: { from } as never, from, c };
}

describe("pagos-reporte", () => {
  it("U-270: cargarPagosPorVenta hace UNA query a pagos filtrada por store_id y agrupa por venta", async () => {
    const { supabase, from, c } = supabaseCon([
      { venta_id: "v1", metodo: "efectivo", monto: "5000" },
      { venta_id: "v1", metodo: "debito", monto: 12000 },
      { venta_id: "v2", metodo: "credito", monto: 3000 },
    ]);
    const mapa = await cargarPagosPorVenta(supabase, STORE, ["v1", "v2", "v1"]);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("pagos");
    expect(c.eq).toHaveBeenCalledWith("store_id", STORE);
    expect(c.in).toHaveBeenCalledWith("venta_id", ["v1", "v2"]);
    expect(mapa.get("v1")).toEqual([
      { metodo: "efectivo", monto: 5000 },
      { metodo: "debito", monto: 12000 },
    ]);
  });

  it("U-271: sin ventas no consulta la BD", async () => {
    const { supabase, from } = supabaseCon([]);
    const mapa = await cargarPagosPorVenta(supabase, STORE, []);
    expect(from).not.toHaveBeenCalled();
    expect(mapa.size).toBe(0);
  });

  it("U-272: solo la venta mixta se reparte; las demás siguen por metodo_pago", () => {
    const pagos = new Map([
      ["m", [{ metodo: "efectivo", monto: 5000 }, { metodo: "debito", monto: 12000 }]],
      ["e", [{ metodo: "nota_credito", monto: 1000 }, { metodo: "efectivo", monto: 2000 }]],
    ]);
    expect(metodosParaAgrupar({ id: "m", total: 17000, metodo_pago: "mixto" }, pagos)).toEqual([
      { metodo: "efectivo", monto: 5000 },
      { metodo: "debito", monto: 12000 },
    ]);
    expect(metodosParaAgrupar({ id: "e", total: 3000, metodo_pago: "efectivo" }, pagos)).toEqual([
      { metodo: "efectivo", monto: 3000 },
    ]);
  });

  it("U-273: montoBoleta — tarjeta 100 % = 0; efectivo + débito = solo efectivo", () => {
    const pagos = new Map([
      ["t", [{ metodo: "credito", monto: 9000 }]],
      ["m", [{ metodo: "efectivo", monto: 5000 }, { metodo: "debito", monto: 12000 }]],
    ]);
    expect(resumenBoleta([{ id: "t", total: 9000, metodo_pago: "credito", canal: "pos" }], pagos)).toEqual({
      montoBoleta: 0,
      boletaPorMetodo: {},
    });
    expect(resumenBoleta([{ id: "m", total: 17000, metodo_pago: "mixto", canal: "pos" }], pagos)).toEqual({
      montoBoleta: 5000,
      boletaPorMetodo: { efectivo: 5000 },
    });
  });

  it("U-274: venta POS antigua sin filas en pagos usa su metodo_pago por el total; canal externo no boletea", () => {
    const r = resumenBoleta(
      [
        { id: "old", total: 4000, metodo_pago: "transferencia", canal: null },
        { id: "oldT", total: 7000, metodo_pago: "debito", canal: "pos" },
        { id: "rap", total: 9000, metodo_pago: "plataforma", canal: "rappi" },
      ],
      new Map()
    );
    expect(r).toEqual({ montoBoleta: 4000, boletaPorMetodo: { transferencia: 4000 } });
  });

  it("U-275: ventasConPagos pide pagos de las mixtas y de las POS, no de las de canal no mixtas", () => {
    expect(
      ventasConPagos([
        { id: "a", total: 1, metodo_pago: "efectivo", canal: "pos" },
        { id: "b", total: 1, metodo_pago: "plataforma", canal: "rappi" },
        { id: "c", total: 1, metodo_pago: "mixto", canal: "pos" },
        { id: "d", total: 1, metodo_pago: "efectivo", canal: null },
      ])
    ).toEqual(["a", "c", "d"]);
  });
});
