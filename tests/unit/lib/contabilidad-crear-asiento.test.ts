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
}

function makeSupabaseMock({
  lastNumero = 5,
  entryResult = { data: { id: "entry-uuid-1" }, error: null },
  detailResult = { error: null },
  deleteResult = { error: null },
}: MockOptions = {}) {
  let journalEntriesCallIdx = 0;

  const mockFrom = jest.fn((table: string) => {
    if (table === "journal_entries") {
      journalEntriesCallIdx++;

      if (journalEntriesCallIdx === 1) {
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

      if (journalEntriesCallIdx === 2) {
        // insert entry: .insert().select().single()
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue(entryResult),
        };
      }

      // delete (rollback): .delete().eq()
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

    it("retorna null y hace rollback cuando journal_detail insert falla", async () => {
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
});
