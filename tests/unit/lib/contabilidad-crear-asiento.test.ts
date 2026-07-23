import type { CrearAsientoInput } from "@/lib/contabilidad/types";

// ─── Mock Supabase ANTES de importar el módulo ───────────────────────────────
const mockCreateServiceClient = jest.fn();

jest.mock("@/lib/supabase", () => ({
  createServiceClient: mockCreateServiceClient,
}));

import { crearAsiento } from "@/lib/contabilidad/generador-asientos";

// ─── Factory: construye un cliente Supabase falso ─────────────────────────────
interface MockOptions {
  lastNumero?: number;
  entryResult?: { data: { id: string } | null; error: { message: string } | null };
  detailResult?: { error: { message: string } | null };
  deleteResult?: { error: null };
  periodoAbierto?: boolean;
  skipPeriodCheck?: boolean;
}

// Cíclico por intento — [0]=nextNumeroAsiento (select), [1]=insert entry,
// [2]=delete de rollback (solo ocurre si journal_detail falló). Necesario
// porque crearAsiento() ahora reintenta el ciclo completo (select→insert→
// detail→[delete si falla]) hasta MAX_DETALLE_RETRIES veces — un mock lineal
// de solo 2 pasos + "todo lo demás es delete" rompería en el 2do intento
// (nextNumeroAsiento necesita .select(), no .delete()).
function makeSupabaseMock({
  lastNumero = 5,
  entryResult = { data: { id: "entry-uuid-1" }, error: null },
  detailResult = { error: null },
  deleteResult = { error: null },
  periodoAbierto = true,
  skipPeriodCheck = false,
}: MockOptions = {}) {
  // periodoAbierto=true/false: hay step 0 (period check).
  // periodoAbierto=false: crearAsiento sale tras el period check.
  // skipPeriodCheck=true: usado para CIERRE_MES (no hay period check).
  const hasPeriodCheck = !skipPeriodCheck;
  let step = 0;

  const mockFrom = jest.fn((table: string) => {
    if (table === "journal_entries") {
      const currentStep = step;
      step++;

      // Period check step (solo si aplica)
      if (hasPeriodCheck && currentStep === 0) {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: periodoAbierto ? [] : [{ id: "cierre-existente" }],
            error: null,
          }),
        };
      }

      // Periodo cerrado: crearAsiento devuelve null sin más consultas
      if (periodoAbierto === false) return {};

      // Ajustar el step si el period check consumió el step 0
      const adjustedStep = hasPeriodCheck ? (currentStep - 1) % 3 : currentStep % 3;

      if (adjustedStep === 0) {
        // nextNumeroAsiento: .select().eq().order().limit().single()
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { numero_asiento: lastNumero },
            error: null,
          }),
        };
      }

      if (adjustedStep === 1) {
        // insert entry: .insert().select().single()
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue(entryResult),
        };
      }

      // delete (rollback tras fallo de journal_detail): .delete().eq()
      return {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue(deleteResult),
      };
    }

    if (table === "journal_detail") {
      return {
        insert: jest.fn().mockResolvedValue(detailResult),
      };
    }

    return {};
  });

  return { from: mockFrom };
}

// ─── Lineas balanceadas de prueba ─────────────────────────────────────────────
const LINEAS_BALANCEADAS: CrearAsientoInput["lineas"] = [
  { cuentaCodigo: "110101", cuentaNombre: "Caja", cuentaTipo: "ACTIVO", debito: 11900, credito: 0 },
  { cuentaCodigo: "210501", cuentaNombre: "IVA por Pagar", cuentaTipo: "PASIVO", debito: 0, credito: 1900 },
  { cuentaCodigo: "410101", cuentaNombre: "Ventas", cuentaTipo: "INGRESO", debito: 0, credito: 10000 },
];

const LINEAS_DESCUADRADAS: CrearAsientoInput["lineas"] = [
  { cuentaCodigo: "110101", cuentaNombre: "Caja", debito: 5000, credito: 0 },
  { cuentaCodigo: "410101", cuentaNombre: "Ventas", debito: 0, credito: 6000 }, // Dr ≠ Cr
];

// Líneas con todos los montos en cero — balanceado pero sin movimiento económico
const LINEAS_CERO: CrearAsientoInput["lineas"] = [
  { cuentaCodigo: "210201", cuentaNombre: "Proveedores", debito: 0, credito: 0 },
  { cuentaCodigo: "110201", cuentaNombre: "Banco", debito: 0, credito: 0 },
];

const INPUT_BASE: CrearAsientoInput = {
  storeId: "store-uuid-001",
  fecha: "2026-04-18",
  tipoMovimiento: "VENTA",
  descripcion: "Venta efectivo test",
  lineas: LINEAS_BALANCEADAS,
};

// ─────────────────────────────────────────────────────────────────────────────
describe("crearAsiento", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateServiceClient.mockReturnValue(makeSupabaseMock());
  });

  describe("validación de balance", () => {
    it("retorna null cuando débitos ≠ créditos", async () => {
      const result = await crearAsiento({ ...INPUT_BASE, lineas: LINEAS_DESCUADRADAS });
      expect(result).toBeNull();
    });

    it("no llama a Supabase cuando está descuadrado", async () => {
      const client = makeSupabaseMock();
      mockCreateServiceClient.mockReturnValue(client);

      await crearAsiento({ ...INPUT_BASE, lineas: LINEAS_DESCUADRADAS });

      expect(client.from).not.toHaveBeenCalled();
    });

    // REGRESIÓN — asiento #43 "Pago proveedor" con monto=0 marcado como "OK"
    // Un asiento 0/0 está matemáticamente balanceado pero carece de movimiento
    // económico y no debe persistirse ni mostrarse como válido.
    it("REGRESIÓN: retorna null cuando todos los montos son cero (asiento $0/$0)", async () => {
      const result = await crearAsiento({ ...INPUT_BASE, lineas: LINEAS_CERO });
      expect(result).toBeNull();
    });

    it("no llama a Supabase cuando todos los montos son cero", async () => {
      const client = makeSupabaseMock();
      mockCreateServiceClient.mockReturnValue(client);

      await crearAsiento({ ...INPUT_BASE, lineas: LINEAS_CERO });

      expect(client.from).not.toHaveBeenCalled();
    });

    it("lineasPagoProveedor(0) produce asiento rechazado por monto cero", async () => {
      const { lineasPagoProveedor } = require("@/lib/contabilidad/generador-asientos");
      const client = makeSupabaseMock();
      mockCreateServiceClient.mockReturnValue(client);

      const lineas = lineasPagoProveedor(0);
      const result = await crearAsiento({
        ...INPUT_BASE,
        tipoMovimiento: "PAGO_PROVEEDOR",
        descripcion: "Pago proveedor - Cuenta cero",
        lineas,
      });

      expect(result).toBeNull();
      expect(client.from).not.toHaveBeenCalled();
    });

    it("acepta entradas con decimales que cuadran por redondeo", async () => {
      const lineasConDecimales: CrearAsientoInput["lineas"] = [
        { cuentaCodigo: "110101", cuentaNombre: "Caja", debito: 11900.001, credito: 0 },
        { cuentaCodigo: "410101", cuentaNombre: "Ventas", debito: 0, credito: 11900.001 },
      ];
      const result = await crearAsiento({ ...INPUT_BASE, lineas: lineasConDecimales });
      expect(result).toBe("entry-uuid-1");
    });
  });

  describe("inserción exitosa", () => {
    it("retorna el ID del asiento creado", async () => {
      const result = await crearAsiento(INPUT_BASE);
      expect(result).toBe("entry-uuid-1");
    });

    it("asigna número de asiento secuencial (lastNumero + 1)", async () => {
      const client = makeSupabaseMock({ lastNumero: 42 });
      mockCreateServiceClient.mockReturnValue(client);

      await crearAsiento(INPUT_BASE);

      // Verificar que el insert usó numero_asiento = 43
      const journalEntriesFrom = client.from.mock.calls
        .filter(([table]: string[]) => table === "journal_entries")
        .map(() => client.from.mock.results);

      // La segunda llamada a from("journal_entries") es el insert
      const insertCallArgs = client.from.mock.calls[1]; // [1] = segunda llamada
      expect(insertCallArgs[0]).toBe("journal_entries");
    });

    it("cuando no hay asientos previos, número = 1", async () => {
      const client = makeSupabaseMock({ lastNumero: 0 });
      mockCreateServiceClient.mockReturnValue(client);

      const result = await crearAsiento(INPUT_BASE);
      expect(result).toBe("entry-uuid-1");
    });

    it("crea las líneas de detalle correctas", async () => {
      const client = makeSupabaseMock();
      mockCreateServiceClient.mockReturnValue(client);

      await crearAsiento(INPUT_BASE);

      // journal_detail.insert fue llamado
      const detailCall = client.from.mock.calls.find(([t]: string[]) => t === "journal_detail");
      expect(detailCall).toBeDefined();
    });
  });

  describe("manejo de errores", () => {
    it("retorna null cuando journal_entries insert falla", async () => {
      const client = makeSupabaseMock({
        entryResult: { data: null, error: { message: "DB error" } },
      });
      mockCreateServiceClient.mockReturnValue(client);

      const result = await crearAsiento(INPUT_BASE);
      expect(result).toBeNull();
    });

    it("retorna null y hace rollback cuando journal_detail insert falla en todos los intentos", async () => {
      const client = makeSupabaseMock({
        detailResult: { error: { message: "FK violation" } },
      });
      mockCreateServiceClient.mockReturnValue(client);

      const result = await crearAsiento(INPUT_BASE);
      expect(result).toBeNull();

      // Debe haber llamado a delete para rollback
      const haDeleteCall = client.from.mock.calls.some(
        ([table]: string[]) => table === "journal_entries"
      );
      expect(haDeleteCall).toBe(true);
    });

    it("retorna null cuando entry.data es null sin error explícito", async () => {
      const client = makeSupabaseMock({
        entryResult: { data: null, error: null },
      });
      mockCreateServiceClient.mockReturnValue(client);

      const result = await crearAsiento(INPUT_BASE);
      expect(result).toBeNull();
    });
  });

  // REGRESIÓN — nextNumeroAsiento() lee-luego-escribe sin lock: dos crearAsiento()
  // concurrentes para la misma tienda (ej. pago múltiple de cuentas por pagar,
  // que dispara un PATCH por cuenta en paralelo) pueden calcular el mismo
  // numero_asiento y chocar contra UNIQUE(store_id, numero_asiento). El asiento
  // perdedor de la carrera debe reintentarse con un número recalculado en vez
  // de perderse silenciosamente.
  describe("reintento por colisión de numero_asiento (condición de carrera)", () => {
    type EntryResult = { data: { id: string } | null; error: { message: string; code?: string } | null };

    function makeRaceConditionMock(insertResults: EntryResult[]) {
      let journalEntriesCallIdx = -1; // -1 porque la llamada 0 es el periodo check

      const mockFrom = jest.fn((table: string) => {
        if (table === "journal_entries") {
          journalEntriesCallIdx++;

          // Llamada 0 = period check (siempre retorna vacío — período abierto)
          if (journalEntriesCallIdx === 0) {
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue({ data: [], error: null }),
            };
          }

          // Llamados impares (1, 3, 5...) = nextNumeroAsiento (select);
          // pares (2, 4, 6...) = insert del asiento
          if (journalEntriesCallIdx % 2 === 1) {
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              order: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({ data: { numero_asiento: 5 }, error: null }),
            };
          }

          const attemptIdx = journalEntriesCallIdx / 2 - 1;
          return {
            insert: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue(insertResults[attemptIdx]),
          };
        }

        if (table === "journal_detail") {
          return { insert: jest.fn().mockResolvedValue({ error: null }) };
        }

        return {};
      });

      return { from: mockFrom };
    }

    it("U-116: reintenta con numero_asiento recalculado cuando el insert choca por UNIQUE (23505) y tiene éxito en el 2do intento", async () => {
      const client = makeRaceConditionMock([
        { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } },
        { data: { id: "entry-uuid-retry" }, error: null },
      ]);
      mockCreateServiceClient.mockReturnValue(client);

      const result = await crearAsiento(INPUT_BASE);

      expect(result).toBe("entry-uuid-retry");
      const journalEntriesCalls = client.from.mock.calls.filter(([t]: string[]) => t === "journal_entries");
      expect(journalEntriesCalls).toHaveLength(5); // period check + 2 pares (select + insert)
    });

    it("U-117: retorna null tras agotar los reintentos si el conflicto de numero_asiento persiste", async () => {
      const colision: EntryResult = { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
      const client = makeRaceConditionMock(Array(5).fill(colision));
      mockCreateServiceClient.mockReturnValue(client);

      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const result = await crearAsiento(INPUT_BASE);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No se pudo generar numero_asiento único"));
      consoleSpy.mockRestore();
    });

    it("U-118: NO reintenta ante errores que no sean de colisión de unicidad", async () => {
      const client = makeRaceConditionMock([
        { data: null, error: { message: "foreign key violation", code: "23503" } },
        { data: { id: "no-deberia-llegar-aqui" }, error: null },
      ]);
      mockCreateServiceClient.mockReturnValue(client);

      const result = await crearAsiento(INPUT_BASE);

      expect(result).toBeNull();
      const journalEntriesCalls = client.from.mock.calls.filter(([t]: string[]) => t === "journal_entries");
      expect(journalEntriesCalls).toHaveLength(3); // period check + un solo par — no reintentó
    });

    // U-119 — REGRESIÓN CRÍTICA: reproduce el escenario real reportado ("la
    // venta no generó su asiento de ingreso, solo aparece el de COGS").
    // postVenta() dispara el asiento de ingreso y el de COGS de la MISMA
    // venta sin esperar uno al otro (fire-and-forget concurrente): ambos
    // calculan next-numero-asiento casi al mismo tiempo, ambos ven el mismo
    // "último número" (ninguno insertó todavía), y ambos intentan insertar
    // con el MISMO numero_asiento — uno gana la carrera, el otro choca contra
    // UNIQUE(store_id, numero_asiento). Sin el reintento, ese segundo asiento
    // se perdía silenciosamente (crearAsiento devolvía null).
    it("U-119: dos crearAsiento() concurrentes para la misma tienda (venta + COGS) NO pierden ningún asiento", async () => {
      let currentMax = 5;
      const usedNumbers = new Set<number>([5]);
      const createdIds: string[] = [];

      const mockFrom = jest.fn((table: string) => {
        if (table === "journal_entries") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            single: jest.fn(() =>
              Promise.resolve({ data: { numero_asiento: currentMax }, error: null })
            ),
            insert: jest.fn((payload: { numero_asiento: number }) => {
              if (usedNumbers.has(payload.numero_asiento)) {
                return {
                  select: jest.fn().mockReturnThis(),
                  single: jest.fn(() =>
                    Promise.resolve({
                      data: null,
                      error: { code: "23505", message: "duplicate key value violates unique constraint" },
                    })
                  ),
                };
              }
              usedNumbers.add(payload.numero_asiento);
              currentMax = Math.max(currentMax, payload.numero_asiento);
              const id = `entry-${payload.numero_asiento}`;
              createdIds.push(id);
              return {
                select: jest.fn().mockReturnThis(),
                single: jest.fn(() => Promise.resolve({ data: { id }, error: null })),
              };
            }),
            delete: jest.fn().mockReturnThis(),
          };
        }
        if (table === "journal_detail") {
          return { insert: jest.fn().mockResolvedValue({ error: null }) };
        }
        return {};
      });

      mockCreateServiceClient.mockReturnValue({ from: mockFrom });

      const lineasCogs: CrearAsientoInput["lineas"] = [
        { cuentaCodigo: "510101", cuentaNombre: "Costo de Venta", debito: 8000, credito: 0 },
        { cuentaCodigo: "111001", cuentaNombre: "Inventario", debito: 0, credito: 8000 },
      ];

      const [ventaId, cogsId] = await Promise.all([
        crearAsiento({ ...INPUT_BASE, descripcion: "Venta efectivo a Juan" }),
        crearAsiento({ ...INPUT_BASE, descripcion: "COGS venta a Juan — costo mercancía", lineas: lineasCogs }),
      ]);

      expect(ventaId).not.toBeNull();
      expect(cogsId).not.toBeNull();
      expect(ventaId).not.toBe(cogsId);
      expect(createdIds).toHaveLength(2);
    });
  });

  // REGRESIÓN CRÍTICA — causa raíz real confirmada contra producción (proyecto
  // wnxrdbnvreofrrmhcybc): venta 20260707-9CE8F125 tiene únicamente el asiento
  // COGS (numero_asiento 79) en journal_entries; no existe asiento de ingreso
  // para esa venta. Se descartó colisión de numero_asiento (ninguna otra fila
  // ocupa el número 79 ni hay hueco en la secuencia) y concurrencia externa
  // (no hay otra venta de la misma tienda en la misma ventana de tiempo). El
  // único punto de falla sin reintento en crearAsiento() es el insert de
  // journal_detail: si falla por CUALQUIER razón transitoria, el rollback
  // (delete de journal_entries) libera el numero_asiento recién usado — la
  // SIGUIENTE llamada a crearAsiento() en la misma request (asiento2/COGS)
  // recalcula next-numero-asiento, ve el número liberado, y lo reclama con
  // éxito, ocultando el hueco. El asiento de ingreso (asiento1) se pierde sin
  // más intentos porque insertJournalEntryConNumeroUnico solo reintenta ante
  // colisión UNIQUE (23505), no ante fallos del insert de journal_detail.
  describe("reintento por fallo transitorio de journal_detail (causa raíz venta 20260707-9CE8F125)", () => {
    function makeDetalleRetryMock(detailResults: Array<{ error: { message: string } | null }>) {
      let step = 0;
      let detailCallIdx = 0;
      const insertedNumeros: number[] = [];
      const deletedIds: string[] = [];

      const mockFrom = jest.fn((table: string) => {
        if (table === "journal_entries") {
          const currentStep = step;
          step++;

          // Step 0 = period check (siempre abierto)
          if (currentStep === 0) {
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue({ data: [], error: null }),
            };
          }

          const adjustedStep = (currentStep - 1) % 3;

          if (adjustedStep === 0) {
            const lastNumero = insertedNumeros.length > 0 ? Math.max(...insertedNumeros) : 5;
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              order: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({ data: { numero_asiento: lastNumero }, error: null }),
            };
          }

          if (adjustedStep === 1) {
            return {
              insert: jest.fn((payload: { numero_asiento: number }) => {
                insertedNumeros.push(payload.numero_asiento);
                return {
                  select: jest.fn().mockReturnThis(),
                  single: jest.fn().mockResolvedValue({
                    data: { id: `entry-intento-${insertedNumeros.length}` },
                    error: null,
                  }),
                };
              }),
            };
          }

          // delete (rollback tras fallo de journal_detail)
          return {
            delete: jest.fn().mockReturnThis(),
            eq: jest.fn((_field: string, id: string) => {
              deletedIds.push(id);
              // "libera" el número asociado a esa entrada para el próximo intento
              return Promise.resolve({ error: null });
            }),
          };
        }

        if (table === "journal_detail") {
          const result = detailResults[detailCallIdx] ?? detailResults[detailResults.length - 1];
          detailCallIdx++;
          return { insert: jest.fn().mockResolvedValue(result) };
        }

        return {};
      });

      return { from: mockFrom, insertedNumeros, deletedIds, getDetailCallCount: () => detailCallIdx };
    }

    // U-124
    it("U-124: REGRESIÓN — reintenta con nuevo numero_asiento cuando journal_detail falla en el 1er intento y tiene éxito en el 2do", async () => {
      const client = makeDetalleRetryMock([
        { error: { message: "connection reset" } },
        { error: null },
      ]);
      mockCreateServiceClient.mockReturnValue(client);

      const result = await crearAsiento(INPUT_BASE);

      expect(result).toBe("entry-intento-2");
      expect(client.getDetailCallCount()).toBe(2);
      expect(client.deletedIds).toHaveLength(1); // rollback del 1er intento fallido
      expect(client.insertedNumeros).toHaveLength(2); // 2 números distintos usados
    });

    // U-125
    it("U-125: retorna null y hace rollback tras agotar reintentos si journal_detail falla en todos los intentos", async () => {
      const client = makeDetalleRetryMock([
        { error: { message: "connection reset" } },
        { error: { message: "connection reset" } },
        { error: { message: "connection reset" } },
      ]);
      mockCreateServiceClient.mockReturnValue(client);

      const result = await crearAsiento(INPUT_BASE);

      expect(result).toBeNull();
      expect(client.getDetailCallCount()).toBe(3);
      expect(client.deletedIds).toHaveLength(3); // rollback en cada uno de los 3 intentos
    });

    // U-126
    it("U-126: loguea el número de intentos agotados cuando journal_detail falla persistentemente", async () => {
      const client = makeDetalleRetryMock([
        { error: { message: "connection reset" } },
        { error: { message: "connection reset" } },
        { error: { message: "connection reset" } },
      ]);
      mockCreateServiceClient.mockReturnValue(client);

      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      await crearAsiento(INPUT_BASE);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("No se pudo crear el detalle del asiento tras 3 intentos")
      );
      consoleSpy.mockRestore();
    });
  });

  describe("campos opcionales", () => {
    it("acepta input sin tipoMovimiento", async () => {
      const input: CrearAsientoInput = { ...INPUT_BASE, tipoMovimiento: undefined };
      const result = await crearAsiento(input);
      expect(result).toBe("entry-uuid-1");
    });

    it("acepta input sin referenciaId ni referenciaNomero", async () => {
      const input: CrearAsientoInput = {
        ...INPUT_BASE,
        referenciaId: undefined,
        referenciaNomero: undefined,
      };
      const result = await crearAsiento(input);
      expect(result).toBe("entry-uuid-1");
    });

    it("acepta input con usuarioId y creadoPor", async () => {
      const input: CrearAsientoInput = {
        ...INPUT_BASE,
        usuarioId: "user-123",
        creadoPor: "sistema_pos",
      };
      const result = await crearAsiento(input);
      expect(result).toBe("entry-uuid-1");
    });
  });

  // U-134 / U-135 — REGRESIÓN: ticket Trello 6a61a41b75e6c54191f0c2c2. crearAsiento()
  // no validaba si el período ya tenía un asiento CIERRE_MES, permitiendo
  // registrar nuevas ventas/NC/asientos en meses contables ya cerrados.
  describe("validación de período cerrado", () => {
    it("U-134: REGRESIÓN — retorna null cuando el período tiene un asiento CIERRE_MES", async () => {
      const client = makeSupabaseMock({ periodoAbierto: false });
      mockCreateServiceClient.mockReturnValue(client);

      const result = await crearAsiento(INPUT_BASE);

      expect(result).toBeNull();
      // Solo debe haber llamado a Supabase una vez (el period check),
      // no debe llegar a insert
      expect(client.from).toHaveBeenCalledTimes(1);
      expect(client.from).toHaveBeenCalledWith("journal_entries");
    });

    it("U-135: permite asiento CIERRE_MES aunque el período ya tenga cierre (él mismo lo crea)", async () => {
      // Skip period check: debe pasar directo a la inserción
      const client = makeSupabaseMock({ skipPeriodCheck: true });
      mockCreateServiceClient.mockReturnValue(client);

      const result = await crearAsiento({
        ...INPUT_BASE,
        tipoMovimiento: "CIERRE_MES",
        descripcion: "Cierre 2026-07 - Costo de ventas",
      });

      expect(result).toBe("entry-uuid-1");
    });

    // U-140 / U-141 — REGRESIÓN encontrada al revisar el fix de U-134/U-135:
    // bloquear TODO movimiento no-CIERRE_MES en un período cerrado también
    // bloqueaba correcciones legítimas de algo ya ocurrido en ese período
    // (no "nuevo negocio"), dejando anular_venta_tx y el backfill de
    // asientos faltantes silenciosamente sin efecto contable.
    it("U-140: permite ANULACION_VENTA aunque el período ya tenga cierre (reverso de venta original del mismo período)", async () => {
      const client = makeSupabaseMock({ skipPeriodCheck: true });
      mockCreateServiceClient.mockReturnValue(client);

      const result = await crearAsiento({
        ...INPUT_BASE,
        tipoMovimiento: "ANULACION_VENTA",
        descripcion: "Anulación venta 2026-04",
      });

      expect(result).toBe("entry-uuid-1");
    });

    it("U-141: permite asiento con creadoPor='backfill' aunque el período ya tenga cierre (reconciliación de asiento faltante)", async () => {
      const client = makeSupabaseMock({ skipPeriodCheck: true });
      mockCreateServiceClient.mockReturnValue(client);

      const result = await crearAsiento({
        ...INPUT_BASE,
        tipoMovimiento: "VENTA",
        creadoPor: "backfill",
        descripcion: "Venta efectivo (backfill)",
      });

      expect(result).toBe("entry-uuid-1");
    });
  });
});
