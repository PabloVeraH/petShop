/**
 * Tests U-177 a U-180: funciones puras de la Fase 4 (catálogo y
 * disponibilidad) de docs/canales-stock/stock_canales_externos.md.
 *   - itemsAPublicar (4.2): qué se envía a la plataforma según el modo del
 *     adaptador (toggle / quantity) y si es una publicación completa.
 *   - armarCatalogo (4.5): productos habilitados, precio del canal (D7, D13,
 *     D14), defensa de tenant.
 *   - cronAutorizado: Bearer CRON_SECRET en tiempo constante.
 * La regla de cupo (D4) y el redondeo (precioCanal) ya están en U-167..U-176.
 */
import { itemsAPublicar, type FilaEstadoDisponibilidad } from "@/lib/canales/application/disponibilidad";
import { armarCatalogo } from "@/lib/canales/application/catalogo";
import { cronAutorizado } from "@/lib/cron-auth";

const STORE = "123e4567-e89b-12d3-a456-426614174000";
const OTRA = "123e4567-e89b-12d3-a456-4266141740ff";

const fila = (sku: string, disponible: boolean, publicado: boolean | null, cupo = 5, cantidadPublicada: number | null = null): FilaEstadoDisponibilidad => ({
  producto_id: `p-${sku}`,
  sku,
  disponible,
  cupo,
  ultimo_disponible_publicado: publicado,
  ultima_cantidad_publicada: cantidadPublicada,
});

describe("itemsAPublicar", () => {
  it("U-177: modo toggle → solo lo que cambió (incluye nunca publicado); completo → todo; sin cantidad", () => {
    const filas = [fila("A", true, true), fila("B", false, true, 0), fila("C", true, null), fila("D", false, false, 0)];
    expect(itemsAPublicar(filas, "toggle", false)).toEqual([
      { sku: "B", disponible: false },
      { sku: "C", disponible: true },
    ]);
    const todos = itemsAPublicar(filas, "toggle", true);
    expect(todos.map((i) => i.sku)).toEqual(["A", "B", "C", "D"]);
    expect(todos.every((i) => !("cantidad" in i))).toBe(true);
    // Un cambio de cupo sin cambio de estado NO genera llamada en toggle.
    expect(itemsAPublicar([fila("A", true, true, 9, 5)], "toggle", false)).toEqual([]);
  });

  it("U-178: modo quantity → envía el cupo (stock − mínimo) y 0 si no está disponible; un cambio de cupo cuenta", () => {
    expect(itemsAPublicar([fila("A", true, true, 9, 5)], "quantity", false)).toEqual([{ sku: "A", disponible: true, cantidad: 9 }]);
    expect(itemsAPublicar([fila("A", true, true, 5, 5)], "quantity", false)).toEqual([]);
    // Deshabilitado / licencia vencida con cupo > 0 → se apaga con cantidad 0.
    expect(itemsAPublicar([fila("B", false, true, 7, 7)], "quantity", false)).toEqual([{ sku: "B", disponible: false, cantidad: 0 }]);
  });
});

describe("armarCatalogo", () => {
  const prod = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    store_id: STORE,
    sku: `SKU-${id}`,
    nombre: `Producto ${id}`,
    precio: 10000,
    precio_oferta: null,
    en_oferta: false,
    activo: true,
    imagen_url: null,
    categorias: { nombre: "Alimentos" },
    ...extra,
  });
  const cfg = (p: ReturnType<typeof prod> | null, extra: Record<string, unknown> = {}) => ({
    producto_id: p?.id ?? "x",
    precio_override: null,
    categoria_canal: null,
    descripcion_canal: null,
    productos: p,
    ...extra,
  });

  it("U-179: precio = override ?? base (oferta D13) × recargo redondeado hacia arriba a la decena (D14)", () => {
    const { items, omitidos } = armarCatalogo(
      [
        cfg(prod("1")),                                              // 10000 × 1,15 = 11500
        cfg(prod("2", { precio: 9999 })),                            // 11498,85 → 11500
        cfg(prod("3", { en_oferta: true, precio_oferta: 8000 })),    // 8000 × 1,15 = 9200
        cfg(prod("4"), { precio_override: 12345 }),                  // override manda
        cfg(prod("5"), { categoria_canal: "Snacks", descripcion_canal: "Rico" }),
      ],
      STORE,
      15
    );
    expect(omitidos).toBe(0);
    expect(items.map((i) => i.precioBruto)).toEqual([11500, 11500, 9200, 12345, 11500]);
    expect(items[0]).toMatchObject({ productoId: "1", sku: "SKU-1", categoria: "Alimentos" });
    expect(items[4]).toMatchObject({ categoria: "Snacks", descripcion: "Rico" });
  });

  it("U-180: omite sin precio válido (cuenta), producto inactivo y producto de OTRA tienda (tenant)", () => {
    const { items, omitidos } = armarCatalogo(
      [
        cfg(prod("1", { precio: null })),
        cfg(prod("2", { precio: 0 }), { precio_override: 5000 }),  // override rescata
        cfg(prod("3", { activo: false })),
        cfg(prod("4", { store_id: OTRA })),
        cfg(null),
      ],
      STORE,
      0
    );
    expect(items.map((i) => i.productoId)).toEqual(["2"]);
    expect(items[0].precioBruto).toBe(5000);
    expect(omitidos).toBe(1);
  });
});

describe("cronAutorizado", () => {
  const original = process.env.CRON_SECRET;
  afterAll(() => {
    process.env.CRON_SECRET = original;
  });
  const req = (h?: string) => ({ headers: new Headers(h ? { authorization: h } : {}) });

  it("U-181: sin CRON_SECRET siempre rechaza (ni 'Bearer undefined'); con secreto solo el Bearer exacto", () => {
    delete process.env.CRON_SECRET;
    expect(cronAutorizado(req("Bearer undefined"))).toBe(false);
    expect(cronAutorizado(req())).toBe(false);
    process.env.CRON_SECRET = "s3creto";
    expect(cronAutorizado(req("Bearer s3creto"))).toBe(true);
    expect(cronAutorizado(req("Bearer s3cretO"))).toBe(false);
    expect(cronAutorizado(req("s3creto"))).toBe(false);
    expect(cronAutorizado(req())).toBe(false);
  });
});
