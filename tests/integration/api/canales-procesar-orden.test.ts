/**
 * Tests I-626 a I-641: procesarOrden — aceptación automática de órdenes de
 * canales externos (Fase 3, §4.2 y pasos 3.2/3.6 de
 * docs/canales-stock/stock_canales_externos.md).
 *
 * Reemplaza a canales-accept.test.ts (aceptación MANUAL, eliminada por D5).
 * Sus contratos siguen cubiertos: I-519 (IVA extraído) → I-628; I-520 (SKU →
 * producto, precio de la plataforma) → I-628; I-521 (accepted + venta_id +
 * confirmación) → I-629; I-522 (asientos) → I-630; I-523 (idempotency key) →
 * I-628; I-524 (reintento idempotente sin repetir efectos) → I-631; I-525
 * (SKU inexistente) → I-632; I-526 (sin stock) → I-633; I-527 (ya procesada)
 * → I-627; I-529 (otra tienda) → I-626; I-530 (procedencia = canal) → I-628.
 *
 * Supabase y crear_venta_tx se simulan: el descuento real de stock y la
 * idempotencia en BD están verificados en las Fases 1/1b y en la 059.
 */
import { crearFakeSupabase, tiene, argsDe, type Op } from "../../helpers/fake-supabase";

const mockCrearAsiento = jest.fn();
const mockSync = jest.fn();
const mockLogAudit = jest.fn();
jest.mock("@/lib/contabilidad/generador-asientos", () => {
  const actual = jest.requireActual("@/lib/contabilidad/generador-asientos");
  return { ...actual, crearAsiento: (...a: unknown[]) => mockCrearAsiento(...a) };
});
jest.mock("@/lib/hub-sync", () => ({ syncProductsToHub: (...a: unknown[]) => mockSync(...a) }));
jest.mock("@/lib/audit", () => ({ logAudit: (...a: unknown[]) => mockLogAudit(...a) }));

import { procesarOrden, idempotencyKeyCanal, ORDEN_MAX_INTENTOS } from "@/lib/canales/application/procesar-orden";
import { CUENTAS } from "@/lib/contabilidad/types";

const STORE = "123e4567-e89b-12d3-a456-426614174000";
const ORDEN = "223e4567-e89b-12d3-a456-426614174001";

const ITEMS = [
  { sku: "SKU-A", nombre: "Alimento 15 kg", cantidad: 2, precio_unitario_bruto: 43990 },
  { sku: "SKU-B", nombre: "Juguete", cantidad: 1, precio_unitario_bruto: 3990 },
];
const PRODUCTOS = [
  { id: "p-a", sku: "SKU-A", costo: 30000, activo: true },
  { id: "p-b", sku: "SKU-B", costo: 1500, activo: true },
];

interface Escenario {
  pendiente?: boolean;           // la orden existe en 'pending' para esta tienda
  reclamoGana?: boolean;         // el UPDATE pending → processing devuelve fila
  intentos?: number;
  items?: typeof ITEMS;
  productos?: typeof PRODUCTOS;
  outboxError?: { code: string } | null;
}

function montar(e: Escenario = {}) {
  const { pendiente = true, reclamoGana = true, intentos = 0, items = ITEMS, productos = PRODUCTOS, outboxError = null } = e;
  const fake = crearFakeSupabase((tabla, ops: Op[]) => {
    if (tabla === "canal_ordenes") {
      if (tiene(ops, "maybeSingle")) return { data: pendiente ? { intentos } : null };
      const upd = argsDe(ops, "update")?.[0] as Record<string, unknown> | undefined;
      if (upd?.estado === "processing") {
        return {
          data: reclamoGana
            ? [{ id: ORDEN, canal_id: "rappi", external_order_id: "EXT-1", items, intentos: intentos + 1 }]
            : [],
        };
      }
      return { data: null };
    }
    if (tabla === "productos") return { data: productos };
    if (tabla === "canal_outbox") return { error: outboxError };
    return {};
  });
  fake.rpc.mockResolvedValue({
    data: { venta: { id: "venta-1", total: 91970, numero_comprobante: "N-1", created_at: "2026-09-25T12:00:00Z" }, created: true },
    error: null,
  });
  return fake;
}

const updatesDe = (fake: ReturnType<typeof montar>, tabla: string) =>
  fake.consultas.filter((c) => c.tabla === tabla && tiene(c.ops, "update"));

beforeEach(() => {
  jest.clearAllMocks();
  mockCrearAsiento.mockResolvedValue("asiento-1");
  mockLogAudit.mockResolvedValue(undefined);
});

describe("procesarOrden — reclamo y tenant", () => {
  it("I-626: la orden se busca y se reclama con el store_id recibido (otra tienda → omitida, sin efectos)", async () => {
    const fake = montar({ pendiente: false });
    expect(await procesarOrden(fake.client, STORE, ORDEN)).toEqual({ resultado: "omitida" });
    expect(tiene(fake.consultas[0].ops, "eq", "store_id", STORE)).toBe(true);
    expect(tiene(fake.consultas[0].ops, "eq", "estado", "pending")).toBe(true);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("I-627: si otro proceso ganó el reclamo (0 filas en pending → processing) no se crea venta", async () => {
    const fake = montar({ reclamoGana: false });
    expect(await procesarOrden(fake.client, STORE, ORDEN)).toEqual({ resultado: "omitida" });
    const reclamo = fake.consultas[1].ops;
    expect(argsDe(reclamo, "update")?.[0]).toMatchObject({ estado: "processing", intentos: 1 });
    expect(tiene(reclamo, "eq", "estado", "pending")).toBe(true);
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});

describe("procesarOrden — aceptación (D5)", () => {
  it("I-628: crear_venta_tx con productos por SKU de la tienda, precio de la plataforma, IVA extraído, procedencia = canal e idempotency key por tienda", async () => {
    const fake = montar();
    await procesarOrden(fake.client, STORE, ORDEN);
    const prod = fake.consultas.find((c) => c.tabla === "productos")!.ops;
    expect(tiene(prod, "eq", "store_id", STORE)).toBe(true);
    expect(tiene(prod, "in", "sku", ["SKU-A", "SKU-B"])).toBe(true);

    const [nombre, args] = fake.rpc.mock.calls[0];
    expect(nombre).toBe("crear_venta_tx");
    expect(args).toMatchObject({
      p_store_id: STORE,
      p_items: [
        { producto_id: "p-a", cantidad: 2, precio_unitario: 43990, subtotal: 87980, mascota_id: null },
        { producto_id: "p-b", cantidad: 1, precio_unitario: 3990, subtotal: 3990, mascota_id: null },
      ],
      p_total: 91970,
      p_subtotal: 91970,
      p_impuesto: 14684,            // extraído: round(91970 × 0,19 / 1,19); NO aditivo (91970 × 0,19 = 17474)
      p_metodo_pago: "plataforma",
      p_canal: "rappi",
      p_procedencia: "rappi",
      p_worker_clerk_id: null,
      p_numero_transaccion: "EXT-1",
      p_idempotency_key: idempotencyKeyCanal(STORE, "rappi", "EXT-1"),
    });
  });

  it("I-629: la orden queda accepted con venta_id (solo desde processing) y se encola la confirmación", async () => {
    const fake = montar();
    expect(await procesarOrden(fake.client, STORE, ORDEN)).toEqual({ resultado: "aceptada", ventaId: "venta-1", creada: true });
    const aceptada = updatesDe(fake, "canal_ordenes").find((c) => (argsDe(c.ops, "update")?.[0] as Record<string, unknown>).estado === "accepted")!;
    expect(argsDe(aceptada.ops, "update")?.[0]).toMatchObject({ estado: "accepted", venta_id: "venta-1" });
    expect(tiene(aceptada.ops, "eq", "estado", "processing")).toBe(true);
    expect(tiene(aceptada.ops, "eq", "store_id", STORE)).toBe(true);
    const outbox = fake.consultas.find((c) => c.tabla === "canal_outbox")!;
    expect(argsDe(outbox.ops, "insert")?.[0]).toMatchObject({
      store_id: STORE, canal_id: "rappi", tipo: "confirm", canal_orden_id: ORDEN,
      payload: { external_order_id: "EXT-1" }, dedupe_key: `confirm:${ORDEN}`,
    });
  });

  it("I-630: asiento de ingreso con la cuenta por cobrar del canal y asiento de COGS; auditoría y sync al Hub (C18)", async () => {
    const fake = montar();
    await procesarOrden(fake.client, STORE, ORDEN);
    expect(mockCrearAsiento).toHaveBeenCalledTimes(2);
    const cogs = mockCrearAsiento.mock.calls[1][0];
    const lineaCogs = cogs.lineas.find((l: { cuentaCodigo: string }) => l.cuentaCodigo === CUENTAS.COGS.codigo);
    expect(lineaCogs.debito).toBe(2 * 30000 + 1500);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "venta", entityId: "venta-1" }));
    expect(mockSync).toHaveBeenCalled();
  });

  it("I-631: reintento idempotente (created=false) acepta la orden pero no repite asientos, auditoría ni sync", async () => {
    const fake = montar();
    fake.rpc.mockResolvedValue({ data: { venta: { id: "venta-1", total: 1, numero_comprobante: "N", created_at: "x" }, created: false }, error: null });
    expect(await procesarOrden(fake.client, STORE, ORDEN)).toEqual({ resultado: "aceptada", ventaId: "venta-1", creada: false });
    expect(mockCrearAsiento).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("I-634: un trabajo de confirmación ya vivo (23505) no es error — dedupe", async () => {
    const fake = montar({ outboxError: { code: "23505" } });
    expect((await procesarOrden(fake.client, STORE, ORDEN)).resultado).toBe("aceptada");
  });
});

describe("procesarOrden — rechazo automático (3.6)", () => {
  it("I-632: SKU sin producto activo en la tienda → rejected ITEM_NOT_FOUND + outbox reject, sin venta", async () => {
    const fake = montar({ productos: [PRODUCTOS[0], { ...PRODUCTOS[1], activo: false }] });
    const r = await procesarOrden(fake.client, STORE, ORDEN);
    expect(r).toMatchObject({ resultado: "rechazada", motivo: "ITEM_NOT_FOUND" });
    expect(fake.rpc).not.toHaveBeenCalled();
    const rechazo = updatesDe(fake, "canal_ordenes").find((c) => (argsDe(c.ops, "update")?.[0] as Record<string, unknown>).estado === "rejected")!;
    expect(tiene(rechazo.ops, "eq", "estado", "processing")).toBe(true);
    const outbox = fake.consultas.find((c) => c.tabla === "canal_outbox")!;
    expect(argsDe(outbox.ops, "insert")?.[0]).toMatchObject({ tipo: "reject", payload: { external_order_id: "EXT-1", motivo: "ITEM_NOT_FOUND" } });
  });

  it("I-633: D16 — la BD rechaza por falta de stock FÍSICO → rejected ITEM_OUT_OF_STOCK + outbox reject", async () => {
    const fake = montar();
    fake.rpc.mockResolvedValue({ data: null, error: { message: "Stock insuficiente: disponible 1, solicitado 2" } });
    const r = await procesarOrden(fake.client, STORE, ORDEN);
    expect(r).toMatchObject({ resultado: "rechazada", motivo: "ITEM_OUT_OF_STOCK" });
    expect(mockCrearAsiento).not.toHaveBeenCalled();
  });

  it("I-635: orden sin ítems → rejected OTHER sin tocar productos", async () => {
    const fake = montar({ items: [] });
    expect(await procesarOrden(fake.client, STORE, ORDEN)).toMatchObject({ resultado: "rechazada", motivo: "OTHER" });
    expect(fake.consultas.some((c) => c.tabla === "productos")).toBe(false);
  });
});

describe("procesarOrden — errores transitorios", () => {
  it("I-636: error no de negocio → vuelve a pending con ultimo_error (reintento)", async () => {
    const fake = montar();
    fake.rpc.mockResolvedValue({ data: null, error: { code: "40P01", message: "deadlock detected" } });
    expect((await procesarOrden(fake.client, STORE, ORDEN)).resultado).toBe("reintentar");
    const upd = updatesDe(fake, "canal_ordenes").at(-1)!;
    expect(argsDe(upd.ops, "update")?.[0]).toMatchObject({ estado: "pending", ultimo_error: "Error creando la venta (40P01)" });
  });

  it("I-637: agotados los intentos → failed (requiere reintento manual de un admin)", async () => {
    const fake = montar({ intentos: ORDEN_MAX_INTENTOS - 1 });
    fake.rpc.mockResolvedValue({ data: null, error: { code: "40P01", message: "deadlock" } });
    expect((await procesarOrden(fake.client, STORE, ORDEN)).resultado).toBe("fallida");
    const upd = updatesDe(fake, "canal_ordenes").at(-1)!;
    expect(argsDe(upd.ops, "update")?.[0]).toMatchObject({ estado: "failed" });
  });
});

// ─── Fase 5 (5.4): auditoría de rechazos y fallas automáticas ──────────────
describe("procesarOrden — auditoría (5.4)", () => {
  it("I-679: rechazo automático y falla definitiva quedan auditados como sistema; un reintento transitorio no", async () => {
    await procesarOrden(montar({ items: [] }).client, STORE, ORDEN);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: STORE, userId: "sistema:canales", entityType: "canal_ordenes", entityId: ORDEN, result: "failure" })
    );
    expect(mockLogAudit.mock.calls.at(-1)![0].changeDescription).toMatch(/rechazado automáticamente: OTHER/);

    mockLogAudit.mockClear();
    let fake = montar({ intentos: 0 });
    fake.rpc.mockResolvedValue({ data: null, error: { code: "40P01", message: "deadlock" } });
    expect((await procesarOrden(fake.client, STORE, ORDEN)).resultado).toBe("reintentar");
    expect(mockLogAudit).not.toHaveBeenCalled();

    fake = montar({ intentos: ORDEN_MAX_INTENTOS - 1 });
    fake.rpc.mockResolvedValue({ data: null, error: { code: "40P01", message: "deadlock" } });
    await procesarOrden(fake.client, STORE, ORDEN);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "canal_ordenes", result: "failure" }));
    expect(mockLogAudit.mock.calls.at(-1)![0].changeDescription).toMatch(/falló tras/);
  });
});
