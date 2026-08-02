/**
 * Tests I-CITA-30 a I-CITA-36: GET /api/servicios/[id]/disponibilidad.
 * El endpoint hace queries directas (no RPC): servicios → excepciones →
 * horarios → citas, y calcula slots con la lib pura.
 */
import { NextRequest } from "next/server";

const STORE_ID = "123e4567-e89b-12d3-a456-426614174000";
const SERVICIO_ID = "123e4567-e89b-12d3-a456-426614174100";

const mockGetStoreId = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/auth", () => ({ getStoreId: mockGetStoreId }));
jest.mock("@/lib/supabase", () => ({
  createServiceClient: jest.fn(() => ({ from: mockFrom })),
}));

const idParams = Promise.resolve({ id: SERVICIO_ID });

function req(url: string) {
  return new NextRequest(`http://localhost${url}`);
}

// Construye el mock de from() por tabla. Cada tabla recibe un chain con los
// métodos que el endpoint usa, terminando en el resultado configurado.
interface Tablas {
  servicio?: { data: unknown; error: unknown };   // .single()
  excepcion?: { data: unknown; error: unknown };  // .maybeSingle()
  horario?: { data: unknown; error: unknown };    // .maybeSingle()
  citas?: { data: unknown; error: unknown };      // .neq() → promise
}

function mockTablas(t: Tablas) {
  mockFrom.mockImplementation((tabla: string) => {
    if (tabla === "servicios") {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ single: () => Promise.resolve(t.servicio) }) }) }) }),
      };
    }
    if (tabla === "servicio_excepciones") {
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(t.excepcion) }) }) }),
        }),
      };
    }
    if (tabla === "servicio_horarios") {
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(t.horario) }) }) }),
        }),
      };
    }
    if (tabla === "citas") {
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => ({ neq: () => Promise.resolve(t.citas) }) }) }),
        }),
      };
    }
    throw new Error(`tabla inesperada: ${tabla}`);
  });
}

const SERVICIO_OK = { data: { id: SERVICIO_ID, duracion_minutos: 30 }, error: null };

// 2026-08-10 es lunes (ISODOW=1). Verificado: new Date("2026-08-10T00:00:00Z").getUTCDay() === 1 → ISO = ((1+6)%7)+1 = 1.
const LUNES = "2026-08-10";

describe("GET /api/servicios/[id]/disponibilidad", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoreId.mockResolvedValue({ userId: "u1", storeId: STORE_ID });
  });

  // I-CITA-30
  it("I-CITA-30: servicio de otra tienda → 404", async () => {
    mockTablas({ servicio: { data: null, error: null } });
    const { GET } = await import("@/app/api/servicios/[id]/disponibilidad/route");
    const res = await GET(req(`/api/servicios/${SERVICIO_ID}/disponibilidad?fecha=${LUNES}`), { params: idParams });
    expect(res.status).toBe(404);
  });

  // I-CITA-31
  it("I-CITA-31: fecha ausente o con formato inválido → 400", async () => {
    const { GET } = await import("@/app/api/servicios/[id]/disponibilidad/route");
    const res1 = await GET(req(`/api/servicios/${SERVICIO_ID}/disponibilidad`), { params: idParams });
    expect(res1.status).toBe(400);
    const res2 = await GET(req(`/api/servicios/${SERVICIO_ID}/disponibilidad?fecha=10/08/2026`), { params: idParams });
    expect(res2.status).toBe(400);
  });

  // I-CITA-32
  it("I-CITA-32: día sin servicio_horarios configurado → 200 array vacío", async () => {
    mockTablas({
      servicio: SERVICIO_OK,
      excepcion: { data: null, error: null },
      horario: { data: null, error: null },
    });
    const { GET } = await import("@/app/api/servicios/[id]/disponibilidad/route");
    const res = await GET(req(`/api/servicios/${SERVICIO_ID}/disponibilidad?fecha=${LUNES}`), { params: idParams });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  // I-CITA-33
  it("I-CITA-33: día con excepción cerrado=true → 200 array vacío", async () => {
    mockTablas({
      servicio: SERVICIO_OK,
      excepcion: { data: { cerrado: true, hora_inicio: null, hora_fin: null }, error: null },
    });
    const { GET } = await import("@/app/api/servicios/[id]/disponibilidad/route");
    const res = await GET(req(`/api/servicios/${SERVICIO_ID}/disponibilidad?fecha=${LUNES}`), { params: idParams });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  // I-CITA-34
  it("I-CITA-34: excepción cerrado=false → usa la ventana de la excepción, no la semanal", async () => {
    mockTablas({
      servicio: SERVICIO_OK,
      excepcion: { data: { cerrado: false, hora_inicio: "14:00:00", hora_fin: "16:00:00" }, error: null },
      citas: { data: [], error: null },
    });
    const { GET } = await import("@/app/api/servicios/[id]/disponibilidad/route");
    const res = await GET(req(`/api/servicios/${SERVICIO_ID}/disponibilidad?fecha=${LUNES}`), { params: idParams });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Ventana 14:00-16:00 con slots de 30min: 14:00, 14:30, 15:00, 15:30
    expect(body).toHaveLength(4);
    expect(body[0].hora_inicio).toBe("14:00");
    expect(body[3].hora_inicio).toBe("15:30");
  });

  // I-CITA-35
  it("I-CITA-35: slots que se solapan con una cita existente no aparecen", async () => {
    mockTablas({
      servicio: SERVICIO_OK,
      excepcion: { data: null, error: null },
      horario: { data: { hora_inicio: "09:00:00", hora_fin: "11:00:00" }, error: null },
      citas: { data: [{ hora_inicio: "09:30:00", hora_fin: "10:00:00" }], error: null },
    });
    const { GET } = await import("@/app/api/servicios/[id]/disponibilidad/route");
    const res = await GET(req(`/api/servicios/${SERVICIO_ID}/disponibilidad?fecha=${LUNES}`), { params: idParams });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Ventana 09:00-11:00 con slots de 30min: 09:00, 09:30(ocupado), 10:00, 10:30
    expect(body.map((s: { hora_inicio: string }) => s.hora_inicio)).toEqual(["09:00", "10:00", "10:30"]);
  });

  // I-CITA-36
  it("I-CITA-36: el último slot respeta que la duración completa quepa en la ventana", async () => {
    // duracion 60: valor válido del enum {30,60,90} (migración 063, requisito del usuario)
    mockTablas({
      servicio: { data: { id: SERVICIO_ID, duracion_minutos: 60 }, error: null },
      excepcion: { data: null, error: null },
      horario: { data: { hora_inicio: "09:00:00", hora_fin: "10:30:00" }, error: null },
      citas: { data: [], error: null },
    });
    const { GET } = await import("@/app/api/servicios/[id]/disponibilidad/route");
    const res = await GET(req(`/api/servicios/${SERVICIO_ID}/disponibilidad?fecha=${LUNES}`), { params: idParams });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Ventana 09:00-10:30 con duración 60min: solo cabe 09:00-10:00.
    // El siguiente slot sería 10:00-11:00 que excede 10:30 → no se genera.
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({ hora_inicio: "09:00", hora_fin: "10:00" });
  });
});
